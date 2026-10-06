import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SafeHtml } from './html.js';

export function parseCookies(req: IncomingMessage): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

const MAX_BODY_BYTES = 256 * 1024;

export async function readFormBody(req: IncomingMessage): Promise<URLSearchParams> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error('Request body too large.');
    }
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function sendHtml(res: ServerResponse, body: SafeHtml, status = 200): void {
  const payload = Buffer.from(body.toString(), 'utf8');
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(payload.length),
  });
  res.end(payload);
}

export function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { location });
  res.end();
}

export function sendText(res: ServerResponse, body: string, status = 200): void {
  const payload = Buffer.from(body, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(payload.length),
  });
  res.end(payload);
}

export function setCookie(res: ServerResponse, name: string, value: string, maxAgeSeconds: number): void {
  const encoded = encodeURIComponent(value);
  res.setHeader(
    'set-cookie',
    `${name}=${encoded}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`,
  );
}

export function clearCookie(res: ServerResponse, name: string): void {
  res.setHeader('set-cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}
