import type { Core } from '../../src/core/index.js';
import { startTestService } from './service.js';

/** Minimal cookie-keeping HTTP client, so the smoke tests exercise the real server. */
export class WebClient {
  private cookie = '';

  constructor(private readonly baseUrl: string) {}

  async get(path: string): Promise<Response> {
    return this.send(path, { method: 'GET' });
  }

  async post(path: string, form: Record<string, string>): Promise<Response> {
    return this.send(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  }

  async text(path: string): Promise<string> {
    return (await this.get(path)).text();
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    const response = await fetch(new URL(path, this.baseUrl), { ...init, headers, redirect: 'manual' });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0] ?? '';
    return response;
  }
}

export async function startTestWeb(core: Core): Promise<{ client: WebClient; close: () => Promise<void> }> {
  const service = await startTestService(core);
  return { client: new WebClient(service.baseUrl), close: service.close };
}
