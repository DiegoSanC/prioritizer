import type { Core, PersonRef, Role } from '../core/index.js';
import { DomainError, ROLES } from '../core/index.js';
import { defaultWindow, isCleanPass, runIngest, type IngestPass } from '../ingest/index.js';
import { FIREFLIES_TOOL, httpTransport } from '../ingest/fireflies.js';

export type Output = (line: string) => void;

export const USAGE = [
  'Usage: npm run cli -- <command>',
  '',
  '  people                              lists people and their roles',
  '  people add <name>                   registers a person',
  // The roles are named from the core, so a new one is offered here the day it exists.
  `  roles grant <person> <role>         grants a role (${ROLES.join(' | ')})`,
  '  roles revoke <person> <role>        revokes a role',
  '  tokens                              lists issued tokens (never their value)',
  '  tokens issue <person> <label>       issues a token and shows it exactly once',
  '  tokens revoke <token-id>            revokes a token',
  '  alias                               lists the person↔transcript-name aliases',
  '  alias add <person> <name>           that transcript name becomes that person',
  '  alias edit <alias-id> <person> <name>',
  '                                      corrects the whole alias',
  '  alias remove <alias-id>             removes an alias',
  '  invocations                         shows the MCP log: requests and denials',
  '  ingest <person> [from] [to]         runs an ingest pass and summarizes what it did',
  '',
  '<person> accepts the identifier or the exact name.',
  'An alias is the name the transcript attributes work to; with it the ingested action',
  'arrives with an assignee. They are compared ignoring case and whitespace, and nothing',
  'else: accents count. Never alias an unidentified speaker label («Speaker 2») or a',
  'collective («Todos»): they are someone different in every meeting.',
  'The database is chosen with the PRIORITIZER_DB environment variable.',
  'The ingest needs FIREFLIES_API_KEY; [from] and [to] are YYYY-MM-DD dates and, without',
  'them, the last week is read. FIREFLIES_ENDPOINT points somewhere other than Fireflies,',
  'which is the only way to rehearse it without credentials.',
].join('\n');

/**
 * The operator's manual path: no SSO and no admin screen for a deployment of a couple of
 * teams, just this. It is a thin adapter over the core, like the web.
 *
 * Only the ingest is asynchronous — it talks to another service — so the return type says
 * so instead of making every command pretend to be. An unknown command still refuses
 * synchronously, because getting the name wrong is not something to await.
 */
export function runCli(core: Core, argv: string[], out: Output): void | Promise<void> {
  const [command, ...rest] = argv;

  switch (command) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      out(USAGE);
      return;
    case 'people':
      people(core, rest, out);
      return;
    case 'roles':
      roles(core, rest, out);
      return;
    case 'tokens':
      tokens(core, rest, out);
      return;
    case 'alias':
      alias(core, rest, out);
      return;
    case 'invocations':
      invocations(core, out);
      return;
    case 'ingest':
      return ingest(core, rest, out);
    default:
      throw new DomainError('validation', `Unknown command: ${command}.\n\n${USAGE}`);
  }
}

function people(core: Core, argv: string[], out: Output): void {
  const [action, ...rest] = argv;

  if (action === undefined) {
    const everyone = core.listPeople();
    if (everyone.length === 0) {
      out('No people registered yet.');
      return;
    }
    for (const person of everyone) {
      const roles = person.roles.length > 0 ? person.roles.join(', ') : 'no roles';
      out(`${person.id}  ${person.name}  (${roles})`);
    }
    return;
  }

  if (action === 'add') {
    const person = core.addPerson({ name: rest.join(' ') });
    out(`Registered ${person.name}: ${person.id}`);
    return;
  }

  throw unknownAction('people', action);
}

function roles(core: Core, argv: string[], out: Output): void {
  const [action, reference, role] = argv;

  if (action !== 'grant' && action !== 'revoke') {
    throw unknownAction('roles', action);
  }

  const person = core.resolvePerson(reference ?? '');
  const named = requireRole(role);

  if (action === 'grant') {
    core.grantRole(person.id, named);
    out(`${person.name} is now a ${named}.`);
    return;
  }

  core.revokeRole(person.id, named);
  out(`${person.name} is no longer a ${named}.`);
}

function tokens(core: Core, argv: string[], out: Output): void {
  const [action, ...rest] = argv;

  if (action === undefined) {
    const issued = core.listTokens();
    if (issued.length === 0) {
      out('No tokens issued yet.');
      return;
    }
    for (const token of issued) {
      const state = token.revokedAt ? `revoked ${token.revokedAt}` : 'active';
      const used = token.lastUsedAt ? `last used ${token.lastUsedAt}` : 'never used';
      out(`${token.id}  ${token.person.name}  «${token.label}»  ${state}, ${used}`);
    }
    return;
  }

  if (action === 'issue') {
    const [reference, ...label] = rest;
    const person = core.resolvePerson(reference ?? '');
    const token = core.issueToken({ person: person.id, label: label.join(' ') });
    out(`Token for ${person.name} («${token.label}»), write it down now — it is never shown again:`);
    out('');
    out(`  ${token.value}`);
    out('');
    out(`Identifier to revoke it: ${token.id}`);
    return;
  }

  if (action === 'revoke') {
    core.revokeToken(rest[0] ?? '');
    out('Token revoked.');
    return;
  }

  throw unknownAction('tokens', action);
}

/**
 * The alias table, administered from here and nowhere else.
 *
 * It sits with the rest of the operator's setup — people, roles, tokens — because it is
 * the same kind of job: a handful of rows written when a deployment starts and touched again
 * only when a pass reports a name it could not place. The web is the product's surface for
 * triaging and consolidating, and it never needs to know a transcript's vocabulary.
 */
function alias(core: Core, argv: string[], out: Output): void {
  const [action, ...rest] = argv;

  if (action === undefined) {
    const aliases = core.listAliases();
    if (aliases.length === 0) {
      out('No aliases registered yet.');
      return;
    }
    for (const entry of aliases) {
      out(`${entry.id}  «${entry.alias}» → ${entry.person.name}`);
    }
    return;
  }

  if (action === 'add') {
    const [reference, ...name] = rest;
    const person = core.resolvePerson(reference ?? '');
    const created = core.addAlias({ person: person.id, alias: name.join(' ') });
    out(`«${created.alias}» is ${person.name}: ${created.id}`);
    return;
  }

  if (action === 'edit') {
    const [id, reference, ...name] = rest;
    const person = core.resolvePerson(reference ?? '');
    const updated = core.updateAlias(id ?? '', { person: person.id, alias: name.join(' ') });
    out(`«${updated.alias}» is now ${person.name}.`);
    return;
  }

  if (action === 'remove') {
    core.removeAlias(rest[0] ?? '');
    out('Alias removed. What was already ingested keeps the assignee it was given.');
    return;
  }

  throw unknownAction('alias', action);
}

function invocations(core: Core, out: Output): void {
  const log = core.listInvocations();
  if (log.length === 0) {
    out('The MCP has not been invoked yet.');
    return;
  }
  for (const invocation of log) {
    // A denied call named no tool; say so rather than print a blank to interpret.
    const tool = invocation.tool ?? '(no tool)';
    const detail = invocation.detail ? `  ${invocation.detail}` : '';
    out(`${invocation.at}  ${invocation.person.name}  ${tool}  ${invocation.outcome}${detail}`);
  }
}

/**
 * The ingest, run by hand or by whatever the operator schedules to run it by hand.
 *
 * There is no timer inside the service and no queue beside it: the spec buys one
 * deployable service and nothing else, and a pass whose parser nobody has yet seen work
 * against a real payload has no business running unwatched. `cron` calling this command
 * is a scheduled ingest without a line of scheduling code — and the operator who is
 * named here is the one who signs every action it registers.
 */
async function ingest(core: Core, argv: string[], out: Output): Promise<void> {
  const [reference, from, to] = argv;
  const actor = core.resolvePerson(reference ?? '');

  const apiKey = (process.env['FIREFLIES_API_KEY'] ?? '').trim();
  if (apiKey === '') {
    throw new DomainError(
      'validation',
      'The Fireflies API key is missing: set it in the FIREFLIES_API_KEY environment variable.',
    );
  }

  const fallback = defaultWindow(new Date());
  const window = { fromDate: from ?? fallback.fromDate, toDate: to ?? fallback.toDate };

  const pass = await runIngest(core, {
    actor: actor.id,
    transport: httpTransport({ apiKey, endpoint: process.env['FIREFLIES_ENDPOINT'] }),
    ...window,
  });

  const clean = isCleanPass(pass);
  reportPass(pass, { actor, ...window }, out, clean);

  // Said after the summary and not instead of it: what landed, landed, and the operator
  // still has to know the pass cannot be read as the whole window.
  if (!clean) {
    throw new Error(
      'The ingest pass was not clean: material was left unread and the window cannot be ' +
        'considered complete. Run it again — what was already ingested is not duplicated.',
    );
  }
}

/** What a pass did, in the operator's words. The CLI formats; the pass decided. */
function reportPass(
  pass: IngestPass,
  context: { actor: PersonRef; fromDate: string; toDate: string },
  out: Output,
  clean: boolean,
): void {
  const day = (iso: string) => iso.slice(0, 10);
  out(
    `${FIREFLIES_TOOL} ingest pass from ${day(context.fromDate)} to ` +
      `${day(context.toDate)}, signed by ${context.actor.name}.`,
  );
  const outcome = pass.outcome;
  out(`  ${count(pass.meetings, 'meeting read', 'meetings read')}`);
  out(
    `  ${count(outcome.registered.length, 'action registered', 'actions registered')} into the triage inbox`,
  );
  // The three assignee counts partition what was just registered, so they are printed
  // together even at zero: a breakdown that hid the empty ones would stop adding up.
  if (outcome.registered.length > 0) {
    out(`    ${outcome.resolvedAssignee} with the assignee resolved by alias`);
    out(`    ${outcome.unattributed} the meeting attributed to nobody`);
    out(`    ${outcome.unresolvedAssignee} with an attributed name and no alias, for a human to triage:`);
    // By name and not just by count: the count says how big the gap is, the names say
    // which alias would close it — and which never should, being a collective or an
    // unidentified speaker. See `alias` for why that judgement stays with the operator.
    for (const name of outcome.unresolvedNames) {
      out(`      «${name}»`);
    }
  }
  out(`  ${count(outcome.alreadySeen, 'item already seen', 'items already seen')}, not duplicated`);
  if (pass.unread.length > 0) {
    out(`  ${count(pass.unread.length, 'line it could not read', 'lines it could not read')}:`);
    for (const { sourceId, line } of pass.unread) {
      out(`    ${sourceId}  ${line}`);
    }
  }
  if (clean) return;
  out(`  WARNING: the pass was NOT clean.`);
  if (pass.truncated) {
    out('    it stopped partway through the window: there may be unread meetings');
  }
  if (pass.holes > 0) {
    out(`    ${count(pass.holes, 'meeting did not arrive', 'meetings did not arrive')} in the response`);
  }
  for (const error of pass.errors) {
    out(`    ${error.code}: ${error.message}`);
  }
}

function count(total: number, singular: string, plural: string): string {
  return `${total} ${total === 1 ? singular : plural}`;
}

function requireRole(role: string | undefined): Role {
  const named = ROLES.find((candidate) => candidate === role);
  if (!named) {
    throw new DomainError('validation', `The role must be one of: ${ROLES.join(', ')}.`);
  }
  return named;
}

function unknownAction(command: string, action: string | undefined): DomainError {
  return new DomainError(
    'validation',
    `Unknown command: ${command} ${action ?? ''}.\n\n${USAGE}`,
  );
}
