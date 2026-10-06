import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCore } from '../support/with-core.js';
import { startTestWeb, type WebClient } from '../support/web-client.js';

/**
 * A single trip through the real service, end to end: without a cookie there is no screen,
 * a made-up token does not open the door, and with the good token an action is registered
 * and read back. What each screen shows is tested against its presenter
 * (`pages.test.ts`) and the edge contracts in `shell.test.ts`.
 */
describe('web: boot smoke', () => {
  const h = useCore();
  let client: WebClient;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ client, close } = await startTestWeb(h.core));
  });

  afterEach(async () => {
    await close();
  });

  it('logs in with a token, registers an action and reads it back', async () => {
    const marta = h.core.addPerson({ name: 'Marta' });
    const token = h.core.issueToken({ person: marta.id, label: 'web' });

    const sinSesion = await client.get('/');
    expect(sinSesion.status).toBe(303);
    expect(sinSesion.headers.get('location')).toBe('/login');

    const inventado = await client.post('/login', { token: 'prz_inventado' });
    expect(inventado.status).toBe(401);

    const entrada = await client.post('/login', { token: token.value });
    expect(entrada.status).toBe(303);

    const registrada = await client.post('/actions', {
      text: 'Cerrar el contrato de pagos',
      initiative: 'Checkout',
      assignee: '',
    });
    expect(registrada.status).toBe(303);

    const jerarquia = await client.text('/');
    expect(jerarquia).toContain('Cerrar el contrato de pagos');
    expect(jerarquia).toContain('Triage inbox · 1 untriaged');

    // The published page is read by anyone in the organization, with no credentials: this
    // client carries a cookie, but that route does not even look at it.
    const publicada = await client.get('/published');
    expect(publicada.status).toBe(200);
    expect(await publicada.text()).toContain('Hierarchy in force');
  });
});
