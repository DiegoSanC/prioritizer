import { afterEach, beforeEach } from 'vitest';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { startTestMcp, type McpHarness } from './mcp-client.js';
import type { CoreHarness } from './with-core.js';

/**
 * The world every MCP edge test starts from: Marta consolidates, Juan owns the token his
 * agent calls with, and the actions are always built through the core — never through the
 * tools under test, which would make the setup depend on what is being proved.
 */
export interface McpAgentHarness {
  /** Builds the world: holds the roles the ladder needs, `triador` and `consolidador`. */
  marta: string;
  /** The person the connected agent's token belongs to. */
  juan: string;
  /** A real MCP client over HTTP, carrying Juan's token. */
  agent: Client;
  /** One more agent, with the token of whoever is asked for. */
  connect(personId: string, label: string): Promise<Client>;
  /** Leaves the action accepted and unconsolidated — this is what ages the hierarchy. */
  accepted(text: string, assignee?: string | null): string;
  /** Leaves the action accepted and holding a position in the draft: ready to consolidate. */
  drafted(text: string, assignee?: string | null): string;
  /** Leaves the action prioritised and inside the hierarchy in force. */
  prioritized(text: string, assignee?: string | null): string;
}

/** Boots the real service and connects an agent, around the given harness's core. */
export function useMcpAgent(h: CoreHarness): McpAgentHarness {
  const harness = {} as McpAgentHarness;
  let mcp: McpHarness;

  beforeEach(async () => {
    mcp = await startTestMcp(h.core);
    harness.marta = h.core.addPerson({ name: 'Marta' }).id;
    harness.juan = h.core.addPerson({ name: 'Juan' }).id;
    h.core.grantRole(harness.marta, 'triager');
    h.core.grantRole(harness.marta, 'consolidator');

    harness.connect = (personId, label) =>
      mcp.connect(h.core.issueToken({ person: personId, label }).value);
    harness.agent = await harness.connect(harness.juan, 'agente de Juan');

    // The three rungs of the ladder, each built on the one below it, so a test asks for
    // the state it needs and never for the steps that got there.
    harness.accepted = (text, assignee = harness.juan) => {
      const action = h.core.registerAction({
        text,
        initiative: 'Checkout',
        assignee,
        actor: harness.marta,
      });
      h.core.acceptAction(action.id, { actor: harness.marta });
      return action.id;
    };

    harness.drafted = (text, assignee = harness.juan) => {
      const id = harness.accepted(text, assignee);
      h.core.placeInDraft(id);
      return id;
    };

    harness.prioritized = (text, assignee = harness.juan) => {
      const id = harness.drafted(text, assignee);
      h.core.consolidate({ actor: harness.marta, reason: 'Orden acordado en el comité' });
      return id;
    };
  });

  afterEach(async () => {
    await mcp.close();
  });

  return harness;
}
