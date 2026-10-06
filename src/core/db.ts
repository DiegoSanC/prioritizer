import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

/**
 * Schema migrations, applied in order and tracked with SQLite's `user_version`.
 * Append only — never edit a migration that has shipped.
 */
const MIGRATIONS: string[] = [
  // 1 — people and the action aggregate (its whole lifecycle lives in one table).
  `
  create table people (
    id          text primary key,
    name        text not null unique,
    created_at  text not null
  );

  create table actions (
    id                text primary key,
    text              text not null,
    initiative        text not null,
    assignee_id       text references people(id),
    status            text not null,
    origin_kind       text not null,
    duplicate_of      text references actions(id),
    completed_at      text,
    completed_by      text references people(id),
    evidence_comment  text,
    evidence_links    text,
    created_at        text not null,
    created_by        text not null references people(id)
  );

  create index actions_status_idx on actions(status);

  create table action_transitions (
    id          integer primary key autoincrement,
    action_id   text not null references actions(id),
    from_status text,
    to_status   text not null,
    at          text not null,
    by          text not null references people(id),
    note        text
  );

  create index action_transitions_action_idx on action_transitions(action_id, id);
  `,

  // 2 — roles and personal tokens, both issued by hand by the operator (no SSO in v1).
  `
  create table person_roles (
    person_id  text not null references people(id),
    role       text not null,
    granted_at text not null,
    primary key (person_id, role)
  );

  create table tokens (
    id           text primary key,
    person_id    text not null references people(id),
    label        text not null,
    token_hash   text not null unique,
    issued_at    text not null,
    revoked_at   text,
    last_used_at text
  );
  `,

  // 3 — the draft hierarchy: the proposed global order, ahead of consolidation.
  `
  create table draft_positions (
    action_id text primary key references actions(id),
    position  integer not null
  );
  `,

  // 4 — consolidations: immutable, append-only, signed snapshots. The history is
  // derived from this sequence; there is no separate history store.
  `
  create table consolidations (
    version         integer primary key,
    consolidated_at text not null,
    consolidated_by text not null references people(id),
    reason          text not null
  );

  create table consolidation_entries (
    version       integer not null references consolidations(version),
    position      integer not null,
    action_id     text not null references actions(id),
    text          text not null,
    initiative    text not null,
    assignee_id   text references people(id),
    primary key (version, position)
  );

  create index consolidation_entries_action_idx on consolidation_entries(action_id);
  `,

  // 5 — the invocation log: who asked the agent what, and when. The adoption success
  // criteria are measured off this table, so it is append-only like the snapshots.
  `
  create table invocations (
    id        integer primary key autoincrement,
    at        text not null,
    person_id text not null references people(id),
    tool      text not null,
    outcome   text not null,
    detail    text
  );

  create index invocations_person_idx on invocations(person_id, at);
  `,

  // 6 — `tool` gives up its NOT NULL so a denied call can say plainly that it named no
  // tool: a sentinel would read as a tool name and quietly inflate any count grouped by
  // tool, which is how adoption is measured. Existing rows are all served invocations
  // and carry their tool over untouched. SQLite cannot relax a constraint in place,
  // hence the rebuild; nothing references `invocations`, so the copy is all it takes.
  `
  create table invocations_new (
    id        integer primary key autoincrement,
    at        text not null,
    person_id text not null references people(id),
    tool      text,
    outcome   text not null,
    detail    text
  );

  insert into invocations_new (id, at, person_id, tool, outcome, detail)
    select id, at, person_id, tool, outcome, detail from invocations;

  drop table invocations;
  alter table invocations_new rename to invocations;

  create index invocations_person_idx on invocations(person_id, at);
  `,

  // 7 — the draft's discussion: light comments a stakeholder leaves on an action of the
  // draft. Nothing here gates anything; consolidating never reads this table. The
  // position is stamped at writing time because a remark about where an action sits
  // stops being legible once the order moves. Nothing to do with `evidence_comment`,
  // which is what closing an action leaves behind.
  `
  create table draft_comments (
    id            integer primary key autoincrement,
    action_id     text not null references actions(id),
    author_id     text not null references people(id),
    at            text not null,
    text          text not null,
    position_then integer
  );

  create index draft_comments_action_idx on draft_comments(action_id, id);
  `,

  // 8 — the lineage of an ingested action: which tool, which meeting, and the digest of
  // the item's own text. Until now `origin_kind` was the only trace, so an action could
  // say it came from an ingest and not say from where. The columns are added rather than
  // the table rebuilt: they are all nullable and every existing row is a manual one, which
  // is exactly what all-null lineage means.
  //
  // The unique index is what actually makes re-running the ingest safe. SQLite counts
  // NULLs as distinct in a unique index, so manual rows — all three columns null — never
  // collide with each other. See `ingestKey` for why the digest is part of the key.
  `
  alter table actions add column source_tool          text;
  alter table actions add column source_id            text;
  alter table actions add column source_meeting_date  text;
  alter table actions add column source_meeting_title text;
  alter table actions add column source_item_hash     text;

  create unique index actions_source_item_idx
    on actions(source_tool, source_id, source_item_hash);
  `,

  // 9 — the alias table: which names a transcription tool attributes work to belong to
  // which person. The operator writes it by hand; nothing derives a row from a transcript.
  //
  // `alias` keeps what the operator typed, for them to read back; `alias_key` is the same
  // string reduced to what the comparison actually looks at, and it is unique across the
  // whole table on purpose. One name may not answer for two people: the ingest would have
  // to pick, and picking wrong hands somebody else's work to a homonym. See `aliasKey`.
  //
  // The row points at a person's id, never at their name, so renaming a person could never
  // orphan an alias. The foreign key is there for the day somebody deletes one: it refuses
  // while an alias still names them, which is the honest failure — a dangling alias would
  // resolve to nobody in silence. Neither renaming nor deleting a person exists today, so
  // this is what the schema promises, not something the core has ever had to do.
  `
  create table person_aliases (
    id         text primary key,
    person_id  text not null references people(id),
    alias      text not null,
    alias_key  text not null unique,
    created_at text not null
  );

  create index person_aliases_person_idx on person_aliases(person_id);
  `,

  // The domain switched to English: every persisted Spanish value becomes its English
  // counterpart. Free-text columns (notes, invocation details) are records of what was
  // written at the time and stay as they are.
  `
  update actions set status = case status
    when 'registrada' then 'registered'
    when 'aceptada'   then 'accepted'
    when 'rechazada'  then 'rejected'
    when 'aplazada'   then 'deferred'
    when 'duplicada'  then 'duplicate'
    when 'priorizada' then 'prioritized'
    when 'completada' then 'completed'
    else status end;

  update actions set origin_kind = 'ingested' where origin_kind = 'ingesta';

  update action_transitions set from_status = case from_status
    when 'registrada' then 'registered'
    when 'aceptada'   then 'accepted'
    when 'rechazada'  then 'rejected'
    when 'aplazada'   then 'deferred'
    when 'duplicada'  then 'duplicate'
    when 'priorizada' then 'prioritized'
    when 'completada' then 'completed'
    else from_status end
  where from_status is not null;

  update action_transitions set to_status = case to_status
    when 'registrada' then 'registered'
    when 'aceptada'   then 'accepted'
    when 'rechazada'  then 'rejected'
    when 'aplazada'   then 'deferred'
    when 'duplicada'  then 'duplicate'
    when 'priorizada' then 'prioritized'
    when 'completada' then 'completed'
    else to_status end;

  update person_roles set role = case role
    when 'triador'      then 'triager'
    when 'consolidador' then 'consolidator'
    when 'operador'     then 'operator'
    else role end;

  update invocations set outcome = case outcome
    when 'atendida' then 'handled'
    when 'fallida'  then 'failed'
    when 'denegada' then 'denied'
    else outcome end;
  `,
];

/** Where the single deployable service keeps its store unless PRIORITIZER_DB says otherwise. */
export const DEFAULT_DB_PATH = 'data/prioritizer.sqlite';

export function openDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  const applied = db.pragma('user_version', { simple: true }) as number;
  for (let version = applied; version < MIGRATIONS.length; version += 1) {
    const sql = MIGRATIONS[version];
    if (sql === undefined) continue;
    // One transaction per migration: a rebuild that drops a table to relax a constraint
    // must not be able to land halfway and take the rows with it.
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
