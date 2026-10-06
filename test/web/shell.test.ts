import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';
import { startTestWeb, type WebClient } from '../support/web-client.js';

/**
 * The shell's contracts, over HTTP: what reaches the core from a form, which status a
 * refusal comes out with and what remains on the repainted page. What each screen shows
 * is tested against its presenter in `pages.test.ts`; here only the edge.
 */
describe('web: the route shell', () => {
  const h = useCore();
  let client: WebClient;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ client, close } = await startTestWeb(h.core));
  });

  afterEach(async () => {
    await close();
  });

  /** Leaves the session open with the token of whoever is asked for. */
  const entrar = async (personId: string) => {
    const token = h.core.issueToken({ person: personId, label: 'web' });
    await client.post('/login', { token: token.value });
  };

  it('does not admit triage from someone without the role, and leaves the action as it was', async () => {
    const juan = h.core.addPerson({ name: 'Juan' });
    const action = h.core.registerAction({
      text: 'Pendiente de decisión',
      initiative: 'Checkout',
      actor: juan.id,
    });
    await entrar(juan.id);

    const response = await client.post(`/actions/${action.id}/reject`, { note: 'A mano' });

    expect(response.status).toBe(403);
    expect(h.core.getAction(action.id)?.status).toBe('registered');
    // The refusal reads on the page, not as a bare line of text.
    expect(await response.text()).toContain('<code>triager</code>');
  });

  it('carries what the triage form says to the core', async () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    h.core.grantRole(marta.id, 'triager');
    const action = h.core.registerAction({
      text: 'Triar desde la web',
      initiative: 'Checkout',
      actor: marta.id,
    });
    await entrar(marta.id);

    const response = await client.post(`/actions/${action.id}/accept`, {
      initiative: 'Plataforma',
      assignee: marta.id,
    });

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(h.core.getAction(action.id)).toMatchObject({
      status: 'accepted',
      initiative: 'Plataforma',
      assignee: { id: marta.id, name: 'Marta' },
    });
  });

  it('passes the evidence one link per line, as typed', async () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    const action = h.core.registerAction({
      text: 'Migrar el endpoint de pagos',
      initiative: 'Checkout',
      actor: marta.id,
    });
    await entrar(marta.id);

    const response = await client.post(`/actions/${action.id}/complete`, {
      comment: 'Desplegado el martes',
      links: 'https://acme.test/pr/318\nhttps://acme.test/CHK-42',
    });

    expect(response.status).toBe(303);
    expect(h.core.getAction(action.id)).toMatchObject({
      status: 'completed',
      evidence: {
        comment: 'Desplegado el martes',
        links: ['https://acme.test/pr/318', 'https://acme.test/CHK-42'],
      },
    });
  });

  it('translates the core refusal to its status and repaints the whole page', async () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    h.core.grantRole(marta.id, 'consolidator');
    await entrar(marta.id);

    const response = await client.post('/consolidate', { reason: '  ' });
    const page = await response.text();

    expect(response.status).toBe(400);
    expect(h.core.currentConsolidation()).toBeNull();
    // With the core's words and with the forms still in front of the reader.
    expect(page).toContain('The consolidation reason field is required.');
    expect(page).toContain('action="/consolidate"');
    expect(page).toContain('Register an action');

    // And with the reason filled in, the same form signs and redirects as always.
    const firmada = await client.post('/consolidate', { reason: 'Checkout primero' });

    expect(firmada.status).toBe(303);
    expect(h.core.currentConsolidation()?.version).toBe(1);
  });

  it('returns what was typed to the form that refused, and only that one', async () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    h.core.grantRole(marta.id, 'triager');
    h.core.registerAction({ text: 'Ya en el inbox', initiative: 'Checkout', actor: marta.id });
    await entrar(marta.id);

    const page = await (
      await client.post('/actions', { text: 'Cerrar el contrato', initiative: '   ', assignee: '' })
    ).text();

    expect(page).toContain('value="Cerrar el contrato"');
    // And the triage card next to it still says what its action says: the echo belongs
    // to the form that refused, not to the whole screen.
    expect(page).toContain('value="Checkout"');
    expect(h.core.listActions({ status: 'registered' })).toHaveLength(1);
  });

  it('the triage echo overrides what the action said', async () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    h.core.grantRole(marta.id, 'triager');
    const action = h.core.registerAction({
      text: 'Recién llegada',
      initiative: 'Checkout',
      actor: marta.id,
    });
    await entrar(marta.id);

    // Marking as duplicate without saying of which: the core refuses it and the half-typed
    // correction has to stay put, not fall back to what the action used to say.
    const response = await client.post(`/actions/${action.id}/duplicate`, {
      initiative: 'Plataforma',
      assignee: '',
      note: 'Es la misma de la semanal',
      duplicateOf: '',
    });
    const page = await response.text();

    // The status is the core's: without an original, there is no action to merge with.
    expect(response.status).toBe(404);
    expect(page).toContain('value="Plataforma"');
    expect(page).not.toContain('value="Checkout"');
    expect(page).toContain('value="Es la misma de la semanal"');
  });

  it('repaints the closing refusal on the closing page, not the main one', async () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    const action = h.core.registerAction({
      text: 'Migrar el endpoint de pagos',
      initiative: 'Checkout',
      actor: marta.id,
    });
    await entrar(marta.id);

    const response = await client.post(`/actions/${action.id}/complete`, {
      comment: 'Desplegado el martes',
      links: 'esto no es un enlace',
    });
    const page = await response.text();

    expect(response.status).toBe(400);
    expect(h.core.getAction(action.id)?.status).toBe('registered');
    // Each action names the page that shows its objection, and the evidence was typed here.
    expect(page).toContain('Complete an action');
    expect(page).not.toContain('Triage inbox');
    expect(page).toContain('value="Desplegado el martes"');
    expect(page).toContain('esto no es un enlace</textarea');
  });

  it('a question that cannot be understood does not wipe the other answer', async () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    h.core.grantRole(marta.id, 'triager');
    h.core.grantRole(marta.id, 'consolidator');
    const pagos = h.core.registerAction({ text: 'Migrar pagos', initiative: 'Checkout', actor: marta.id });
    const alta = h.core.registerAction({ text: 'Rediseñar el alta', initiative: 'Altas', actor: marta.id });
    h.core.acceptAction(pagos.id, { actor: marta.id });
    h.core.acceptAction(alta.id, { actor: marta.id });
    h.core.setDraftOrder([pagos.id, alta.id]);
    h.core.consolidate({ actor: marta.id, reason: 'Pagos primero' });
    h.core.setDraftOrder([alta.id, pagos.id]);
    h.core.consolidate({ actor: marta.id, reason: 'El alta se adelanta' });
    await entrar(marta.id);

    const response = await client.get('/history?date=el+martes+pasado&from=1&to=2');
    const page = await response.text();

    expect(response.status).toBe(400);
    expect(page).toContain('is not understood');
    expect(page).toContain('From v1 to v2');
  });

  it('an identifier that names nothing answers a page, not a bare line', async () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    await entrar(marta.id);

    const response = await client.get('/actions/no-existe/complete');
    const page = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/html');
    // With the navigation in place, so the reader has a way back.
    expect(page).toContain('href="/history"');
    expect(page).toContain('Marta');
  });

  it('the published page is served with no session, nothing to touch and no copy kept', async () => {
    const response = await client.get('/published');
    const page = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    // Read-only: not a single form nor an invitation to log in.
    expect(page).not.toContain('<form');
    expect(page).not.toContain('/login');
  });

  it('a bad token answers 401 even when the browser carries an open session', async () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    await entrar(marta.id);

    // The repaint answers the request that was refused: it does not swallow the old cookie.
    const response = await client.post('/login', { token: 'prz_inventado' });

    expect(response.status).toBe(401);
    expect(await response.text()).toContain('Invalid or revoked token.');
  });
});
