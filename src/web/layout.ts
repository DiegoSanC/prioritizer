import { html, raw, type SafeHtml } from './html.js';
import type { PersonRef } from '../core/index.js';

const STYLES = `
  :root { color-scheme: light dark; --fg:#16181d; --bg:#fbfbfd; --muted:#5d6470; --line:#dfe2e8;
          --accent:#2f5bea; --warn:#8a5300; --warn-bg:#fff4dc; --card:#fff; }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#e7e9ee; --bg:#14161a; --muted:#9aa2b1; --line:#2c313a;
            --accent:#8fa9ff; --warn:#ffcf7a; --warn-bg:#3a2f14; --card:#1b1e24; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif; color:var(--fg); background:var(--bg); }
  header { border-bottom:1px solid var(--line); padding:14px 24px; display:flex; gap:20px; align-items:baseline; flex-wrap:wrap; }
  header h1 { font-size:17px; margin:0; letter-spacing:-.01em; }
  header nav { display:flex; gap:16px; font-size:14px; }
  header .spacer { margin-left:auto; color:var(--muted); font-size:13px; }
  main { max-width:960px; margin:0 auto; padding:24px; }
  a { color:var(--accent); }
  h2 { font-size:15px; margin:28px 0 10px; letter-spacing:-.01em; }
  h2:first-child { margin-top:0; }
  p.hint { color:var(--muted); font-size:13px; margin:.3em 0 1em; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:16px; margin-bottom:20px; }
  table { width:100%; border-collapse:collapse; font-size:14px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { font-weight:600; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
  tr:last-child td { border-bottom:none; }
  form.inline { display:inline; }
  input[type=text], input[type=url], textarea, select {
    font:inherit; padding:7px 9px; border:1px solid var(--line); border-radius:7px;
    background:var(--bg); color:var(--fg); width:100%; }
  label { display:block; font-size:13px; color:var(--muted); margin-bottom:4px; }
  .field { margin-bottom:12px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; }
  .row > * { flex:1 1 200px; }
  button { font:inherit; padding:7px 13px; border-radius:7px; border:1px solid var(--line);
           background:var(--card); color:var(--fg); cursor:pointer; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button.link { border:none; background:none; color:var(--accent); padding:2px 4px; }
  .badge { display:inline-block; font-size:11px; padding:2px 7px; border-radius:999px;
           border:1px solid var(--line); color:var(--muted); white-space:nowrap; }
  .banner { border:1px solid var(--warn); background:var(--warn-bg); color:var(--warn);
            border-radius:9px; padding:11px 14px; margin-bottom:20px; font-size:14px; }
  .error { border:1px solid #c0392b; background:#fdeceb; color:#8f2018; border-radius:9px;
           padding:11px 14px; margin-bottom:20px; font-size:14px; }
  @media (prefers-color-scheme: dark) { .error { background:#3a1b18; color:#ff9d90; } }
  ol.hierarchy { list-style:none; counter-reset:pos; padding:0; margin:0; }
  ol.hierarchy li { counter-increment:pos; display:flex; gap:12px; align-items:flex-start;
                    padding:10px; border-bottom:1px solid var(--line); }
  ol.hierarchy li:last-child { border-bottom:none; }
  ol.hierarchy li::before { content:counter(pos); font-variant-numeric:tabular-nums; color:var(--muted);
                            min-width:22px; font-size:13px; padding-top:2px; }
  .grow { flex:1; }
  td.pos { width:1%; white-space:nowrap; color:var(--muted); font-variant-numeric:tabular-nums; }
  .muted { color:var(--muted); font-size:13px; }
  .comment { border-left:2px solid var(--line); padding:2px 0 2px 10px; margin:6px 0; font-size:13px; }
  form.discuss { display:flex; gap:8px; margin:8px 0 2px; }
  form.discuss input { font-size:13px; }
  form.discuss button { font-size:13px; white-space:nowrap; }
`;

export interface Nav {
  actor: PersonRef | null;
  active: string;
}

/**
 * The shell of every page. A null nav is the published page: it is read by whoever reaches
 * the URL, with no session and nothing to write, so it carries no links into the surfaces
 * that would only bounce the reader to the login.
 */
export function layout(title: string, nav: Nav | null, body: SafeHtml): SafeHtml {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${nav ? '' : raw('<meta name="robots" content="noindex">')}
<title>${title} · Prioritizer</title>
<style>${raw(STYLES)}</style>
</head>
<body>
<header>
  <h1>Prioritizer</h1>
  ${nav ? productNav(nav) : html`<span class="spacer">Public read-only view</span>`}
</header>
<main>${body}</main>
</body>
</html>`;
}

function productNav(nav: Nav): SafeHtml {
  const link = (href: string, label: string) =>
    nav.active === href ? html`<strong>${label}</strong>` : html`<a href="${href}">${label}</a>`;

  return html`
  <nav>
    ${link('/', 'Hierarchy')}
    ${link('/history', 'History')}
    <a href="/published">Published page</a>
  </nav>
  <span class="spacer">
    ${nav.actor
      ? html`${nav.actor.name} ·
          <form class="inline" method="post" action="/logout">
            <button class="link" type="submit">log out</button>
          </form>`
      : html`<a href="/login">log in</a>`}
  </span>`;
}
