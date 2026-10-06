import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli } from '../../src/cli/commands.js';
import { useCore } from '../support/with-core.js';
import { loadIngestFixture } from '../support/ingest-fixtures.js';

/**
 * The operator's trigger for a pass. The endpoint is pointed at a local stub that answers
 * one recorded fixture, so the whole chain runs — the POST, the bearer, the GraphQL
 * envelope, the parser, the core — without a Fireflies credential, which does not exist.
 */
describe('operator CLI: firing an ingest pass', () => {
  const h = useCore();
  let server: Server;
  let endpoint: string;
  let recibido: { authorization?: string; body: string } | null = null;

  const sirviendo = (fixture: string) =>
    new Promise<void>((resolve) => {
      server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          recibido = { authorization: req.headers.authorization ?? '', body };
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(loadIngestFixture(fixture).response));
        });
      });
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
        resolve();
      });
    });

  beforeEach(() => {
    recibido = null;
    vi.stubEnv('FIREFLIES_API_KEY', 'clave-de-mentira');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    if (server?.listening) await new Promise((resolve) => server.close(resolve));
  });

  const run = async (...argv: string[]): Promise<string> => {
    const lines: string[] = [];
    await runCli(h.core, argv, (line) => lines.push(line));
    return lines.join('\n');
  };

  it('names the ingest among the commands it knows', async () => {
    expect(await run('help')).toContain('ingest');
  });

  it('refuses to run without the API key', async () => {
    h.core.addPerson({ name: 'Ingesta Fireflies' });
    vi.stubEnv('FIREFLIES_API_KEY', '');

    await expect(run('ingest', 'Ingesta Fireflies')).rejects.toThrow(/FIREFLIES_API_KEY/);
  });

  it('demands the ingest signer be a person of the system', async () => {
    await expect(run('ingest', 'Nadie')).rejects.toThrow(/No person answers/);
  });

  it('ingests a meeting end to end and summarizes what it did', async () => {
    await sirviendo('01-typical-meeting.json');
    vi.stubEnv('FIREFLIES_ENDPOINT', endpoint);
    h.core.addPerson({ name: 'Ingesta Fireflies' });

    const salida = await run('ingest', 'Ingesta Fireflies', '2026-07-01', '2026-08-01');

    expect(recibido?.authorization).toBe('Bearer clave-de-mentira');
    // The transcript sentences are never requested: consuming them is a No-Go of the spec.
    expect(recibido?.body).toContain('action_items');
    expect(recibido?.body).not.toContain('sentences');

    expect(salida).toContain('1 meeting read');
    expect(salida).toContain('4 actions registered');
    expect(h.core.listActions({ status: 'registered' })).toHaveLength(4);
  });

  it('fails the pass when the response arrives incomplete, after saying what got in', async () => {
    await sirviendo('08-partial-response-with-errors.json');
    vi.stubEnv('FIREFLIES_ENDPOINT', endpoint);
    h.core.addPerson({ name: 'Ingesta Fireflies' });

    // What arrived intact gets ingested, and even so the pass cannot pass for clean.
    await expect(run('ingest', 'Ingesta Fireflies')).rejects.toThrow(/was not clean/i);
    expect(h.core.listActions()).toHaveLength(1);
  });

  it('shows which attributed names were left without an alias, so they can be registered', async () => {
    await sirviendo('02-problematic-assignees.json');
    vi.stubEnv('FIREFLIES_ENDPOINT', endpoint);
    h.core.addPerson({ name: 'Ingesta Fireflies' });
    h.core.addPerson({ name: 'Juan Pérez' });
    await run('alias', 'add', 'Juan Pérez', 'juan.perez@ejemplo.es');

    const salida = await run('ingest', 'Ingesta Fireflies');

    // The three counts add up to the seven registered actions: none goes uncounted.
    expect(salida).toContain('7 actions registered');
    expect(salida).toContain('1 with the assignee resolved by alias');
    expect(salida).toContain('1 the meeting attributed to nobody');
    expect(salida).toContain('5 with an attributed name and no alias');
    // The one that does have an alias does not show among those still to be registered.
    expect(salida).not.toContain('«juan.perez@ejemplo.es»');
    // The rest do, with their exact name: it is all the operator needs to decide which
    // ones deserve an alias and which — a collective, someone external — do not.
    expect(salida).toContain('«Speaker 2»');
    expect(salida).toContain('«Equipo de Plataforma»');
    expect(salida).toContain('«Lucía»');
    expect(salida).toContain('«Todos»');
  });

  it('shows the lines it could not read and which meeting they came from', async () => {
    await sirviendo('03-useless-texts.json');
    vi.stubEnv('FIREFLIES_ENDPOINT', endpoint);
    h.core.addPerson({ name: 'Ingesta Fireflies' });

    const salida = await run('ingest', 'Ingesta Fireflies');

    expect(salida).toContain('could not read');
    expect(salida).toContain('Fr5yUw9BzI');
    expect(salida).toContain('(31:12)');
  });
});
