import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ShapeOutput, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { DomainError, type Core, type PersonRef, type ServedOutcome } from '../core/index.js';

/** Everything a tool knows about the call it is serving: the core, and who is asking. */
export interface McpSession {
  core: Core;
  /** The person the bearer token belongs to. Tools never see the token itself. */
  actor: PersonRef;
}

/**
 * A tool as this adapter defines it: schemas plus a body that returns the payload and
 * nothing else. Logging the invocation, shaping the result and turning a rejection into
 * an explicit MCP error are the registry's job, so no tool can forget them.
 */
export interface ToolDefinition<Input extends ZodRawShapeCompat, Output extends ZodRawShapeCompat> {
  name: string;
  title: string;
  description: string;
  input: Input;
  output: Output;
  run(session: McpSession, args: ShapeOutput<Input>): ShapeOutput<Output>;
}

export function registerTools(server: McpServer, session: McpSession): void {
  registerTool(server, session, whoami);
  registerTool(server, session, getPriorities);
  registerTool(server, session, completeAction);
}

export function registerTool<Input extends ZodRawShapeCompat, Output extends ZodRawShapeCompat>(
  server: McpServer,
  session: McpSession,
  definition: ToolDefinition<Input, Output>,
): void {
  // The SDK's callback type is a conditional over the schema shape, which TypeScript
  // cannot resolve while the shape is still a type parameter; the cast is that gap only.
  const callback = ((args: ShapeOutput<Input>): CallToolResult =>
    invoke(session, definition, args)) as unknown as ToolCallback<Input>;

  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.input,
      outputSchema: definition.output,
    },
    callback,
  );
}

function invoke<Input extends ZodRawShapeCompat, Output extends ZodRawShapeCompat>(
  session: McpSession,
  definition: ToolDefinition<Input, Output>,
  args: ShapeOutput<Input>,
): CallToolResult {
  let payload: ShapeOutput<Output>;
  try {
    payload = definition.run(session, args);
  } catch (error) {
    // Two different things, kept apart: a refusal the core made on purpose reaches the
    // agent in the core's own words, while an unexpected failure reaches it as a safe
    // message and reaches the operator — log and stderr — as what actually happened.
    // Either way it travels as an explicit error, never as an empty answer.
    const refusal = error instanceof DomainError ? error.message : null;
    if (refusal === null) {
      console.error(`[mcp] ${definition.name} failed:`, error);
    }
    record(session, definition.name, 'failed', refusal ?? describe(error));
    return {
      content: [{ type: 'text', text: refusal ?? SYSTEM_FAILURE }],
      isError: true,
    };
  }

  record(session, definition.name, 'handled', null);
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

/** What an agent is told when the failure was not a rule of the domain. */
const SYSTEM_FAILURE = 'The service could not resolve the request.';

// Only the two outcomes a tool can produce: by the time anything gets here the door has
// already let the agent in, so a denial is not this function's to write.
function record(
  session: McpSession,
  tool: string,
  outcome: ServedOutcome,
  detail: string | null,
): void {
  session.core.recordInvocation({ actor: session.actor.id, tool, outcome, detail });
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The smallest authenticated tool: it proves end to end whose token is being used. */
export const whoami: ToolDefinition<
  Record<string, never>,
  { id: z.ZodString; name: z.ZodString; roles: z.ZodArray<z.ZodString> }
> = {
  name: 'whoami',
  title: 'Token identity',
  description: 'Returns the person who owns the calling token, and their roles.',
  input: {},
  output: {
    id: z.string(),
    name: z.string(),
    roles: z.array(z.string()),
  },
  run: (session) => ({
    id: session.actor.id,
    name: session.actor.name,
    roles: session.core.rolesOf(session.actor.id),
  }),
};

/** A person as every answer names one: never a bare id the agent would have to resolve. */
const personRef = z.object({ id: z.string(), name: z.string() });

/** An action as the agent sees it, in either block of the answer. */
const actionRef = z.object({
  actionId: z.string(),
  text: z.string(),
  initiative: z.string(),
});

/**
 * The shape of an answer to "what do I attack first?". `situation` is what keeps the three
 * cases apart, so no agent can read one as another.
 */
const prioritiesOutput = {
  situation: z
    .enum(['never_consolidated', 'no_pending', 'has_pending'])
    .describe(
      'never_consolidated: nobody has consolidated yet, there is no order to follow. ' +
        'no_pending: there is a hierarchy in force and you have nothing. ' +
        'has_pending: you have prioritized and/or unprioritized actions.',
    ),
  consolidation: z
    .object({
      version: z.number().int(),
      at: z.string(),
      by: personRef,
      reason: z.string(),
    })
    .nullable()
    .describe('Signature of the hierarchy in force. Only null if nobody has ever consolidated.'),
  priorities: z
    .array(actionRef.extend({ position: z.number().int() }))
    .describe('Your actions, in the global order in force. `position` is the global position.'),
  unprioritized: z
    .object({ count: z.number().int(), actions: z.array(actionRef) })
    .describe(
      'Separate block: actions of yours nobody has ordered yet. If count > 0, ' +
        'say there are N unprioritized actions instead of inventing a priority for them.',
    ),
  // Always there, null when it does not apply. A field that is sometimes present and
  // sometimes absent makes the agent tell "up to date" from "nobody told me", and that is
  // where it gets it wrong. Orthogonal to `situation`: one can have nothing pending and
  // still be reading a hierarchy that fell behind days ago.
  staleness: z
    .object({
      since: z.string().describe('Instant since which the hierarchy has been stale, in ISO 8601.'),
      thresholdBusinessHours: z
        .number()
        .int()
        .describe('Business hours tolerated before the warning is raised.'),
    })
    .nullable()
    .describe(
      'Stale hierarchy: there are accepted actions unconsolidated for longer than the ' +
        'threshold. When not null, warn that the hierarchy has been stale since the day ' +
        'of `since` before giving the priorities: they are still the ones in force, but ' +
        'they may no longer reflect the latest agreement. Null is the explicit answer ' +
        'that it is up to date.',
    ),
};

export const getPriorities: ToolDefinition<Record<string, never>, typeof prioritiesOutput> = {
  name: 'get_priorities',
  title: 'Priorities in force',
  description:
    'Returns the actions of the person who owns the token according to the last ' +
    'consolidated hierarchy, with the signature of that consolidation. Always read ' +
    '`situation` before the lists: an empty list can mean you have nothing or that ' +
    'nobody has consolidated yet. When something arrives unprioritized, say so instead ' +
    'of deciding the order yourself, and if `staleness` is not null warn that the ' +
    'hierarchy is stale.',
  input: {},
  output: prioritiesOutput,
  run: (session) => {
    const mine = session.core.prioritiesFor(session.actor.id);
    return {
      situation: mine.situation,
      consolidation: mine.consolidation,
      priorities: mine.ordered,
      // The count travels next to the list on purpose: it is what the agent says out loud
      // ("there are N unprioritized actions"), and the core has already decided what counts.
      unprioritized: { count: mine.unprioritized.length, actions: mine.unprioritized },
      // Untouched from the core, which is what keeps this answer and the published page
      // from ever naming two different days for the same staleness.
      staleness: mine.staleness,
    };
  },
};

/** What the agent sends to close: the action, and whatever it can show for it. */
const completeInput = {
  actionId: z.string().describe('The action identifier, exactly as `get_priorities` gives it.'),
  comment: z.string().optional().describe('Optional evidence: what was done, in one line.'),
  links: z
    .array(z.string())
    .optional()
    .describe(
      'Optional evidence: http(s) URLs to the PR or the external tracker. They are ' +
        'evidence for whoever audits the trail, not an integration: nothing syncs with them.',
    ),
};

/** The closing as it was recorded, so the agent can report back what it just did. */
const completeOutput = {
  // The same three fields `get_priorities` names an action by, so the agent can match
  // what it just closed against the list it was given.
  ...actionRef.shape,
  completedAt: z.string().describe('Instant of the closing, in ISO 8601.'),
  completedBy: personRef,
  evidence: z
    .object({ comment: z.string().nullable(), links: z.array(z.string()) })
    .describe('The evidence as it was stored. No evidence: null comment and zero links.'),
};

export const completeAction: ToolDefinition<typeof completeInput, typeof completeOutput> = {
  name: 'complete_action',
  title: 'Complete an action',
  description:
    'Marks an action of the person who owns the token as completed, with optional ' +
    'evidence (comment and/or links). It leaves the active hierarchy and stops showing ' +
    'up in `get_priorities`, and it remains in the history with its evidence, date and ' +
    'author. It only closes actions that person is the assignee of: anyone else’s are ' +
    'refused. Closing cannot be undone, so confirm before calling.',
  input: completeInput,
  output: completeOutput,
  run: (session, args) => {
    // The rule about who may close what lives in the core; this only names the actor,
    // which at this edge is never a parameter: it is the person the token belongs to.
    const action = session.core.completeOwnAction(args.actionId, {
      actor: session.actor.id,
      comment: args.comment ?? null,
      links: args.links ?? null,
    });
    // The closing as it was recorded, not as it was sent: the agent sees the comment
    // trimmed and the empty links dropped, which is what it should report back.
    return {
      actionId: action.id,
      text: action.text,
      initiative: action.initiative,
      completedAt: action.completedAt,
      completedBy: action.completedBy,
      evidence: action.evidence,
    };
  },
};
