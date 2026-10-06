# Context: Prioritizer

The domain glossary. If a name is here, this is how it is used in the code, the tests, the
issues and the commits; the synonyms we avoid are also here, and why.

Decisions that cost a discussion live in `docs/adr/`.

Since 2026-08-12 the whole repo speaks English: file names, routes, wire fields, persisted
values, UI copy and test titles. Test *data* — the texts of synthetic actions and meetings —
stays in Spanish on purpose: the target teams hold their meetings in Spanish, so real
transcripts arrive that way.

## The domain

- **Action** — a thing that has to be done, out of a meeting or typed by hand. It is the
  only unit of work in the system.
  **"Task" and "ticket" are forbidden**: they name the boxes of the tools this product
  exists to stop coordinating through, and the moment they creep in, so does the idea that
  every team has its own queue.
- **Initiative** — what an action belongs to. Free text; nobody maintains a catalogue.
- **Triage** — deciding on what reaches the inbox: accept, reject, defer or mark duplicate.
  Reactivating a deferred action is one more triage decision, through the same door.
- **Draft** — the proposed global order, under negotiation. No agent ever reads it.
- **Consolidation** — signing the draft as a new, immutable version with a reason. What
  developers' agents read is always the consolidation in force, never the draft.
- **Hierarchy in force** — the last consolidation, crossed with what is still alive. It is
  what `/published` publishes and what the main screen summarizes: the same reading on
  both, because two screens contradicting each other would be worse than having neither.
- **Stale hierarchy** — there are accepted actions left unconsolidated for more business
  hours than the threshold (48 by default). It is a signal, not a gate: nothing stops
  working while it is on, and the two screens that raise it use the same words.
- **Unprioritized** — registered + accepted, exclusively. The deferred do not count, nor do
  the rejected. It is the adoption metric, so the definition does not stretch.
- **Evidence** — the comment and links an action is closed with. It is what remains in the
  history.
  Distinct from the **negotiation** — the discussion about the draft and about positions —
  which never leaves the signed-in screens: the published page shows the signed order and
  nothing else.
- **Rises / falls** — the observation of a diff: where an action sat in one consolidation
  and where it sits in the next. **Up / down** is the opposite, an instruction: moving an
  action in the draft. A position change was asked for by nobody; an instruction was.
- **The two doors** — `authenticate` resolves a token silently and is the web's;
  `admitAgent` is the MCP's and writes a `denied` row to the invocation log when the token
  is revoked. The log measures adoption per agent and per tool, and a browser visit is
  not an invocation. The web receives a `WebCore`, which has no `admitAgent`: the rule is
  a compile error, not a comment.

## The web

- **Presenter** — a page's reading, with a name and in the same file as its view:
  `mainPage`, `historyPage`, `completePage`, `publishedPage`, `loginPage`. It returns the
  page's ViewModel and decides nothing: what the screen may offer is always the core's own
  answer (`canTriage`, `canConsolidate`, `canComplete`).
- **Shell** (`src/web/shell.ts`) — what is true of every route: who is asking, what to do
  when the core refuses, and which status says so. `server.ts` remains the route table,
  and every route is the same thing: session → presenter → view → send.
- **Refusal** — the core's objection (or the entrance door's) repainted onto the page it
  was raised from, with **what was typed still in the fields** and the error's status. A
  refusal does not wipe the screen: whoever just filled three fields does not fill them
  again. Every form has its `source`, so only the one that refused gets the typed values
  back — except the token, which is never repainted.
