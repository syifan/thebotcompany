export function ensureObjectRefs(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS object_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('issue', 'comment', 'tbc_pr', 'tbc_pr_comment')),
      local_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      UNIQUE(type, local_id)
    );
  `);

  const insert = db.prepare('INSERT INTO object_refs (type, local_id, created_at) VALUES (?, ?, ?)');
  const existing = db.prepare('SELECT id FROM object_refs WHERE type = ? AND local_id = ?');
  const backfill = (type, table) => {
    try {
      const rows = db.prepare(`SELECT id, COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) AS created_at FROM ${table} ORDER BY id ASC`).all();
      for (const row of rows) {
        if (!existing.get(type, row.id)) insert.run(type, row.id, row.created_at);
      }
    } catch {}
  };
  backfill('issue', 'issues');
  backfill('tbc_pr', 'tbc_prs');
  backfill('comment', 'comments');
  backfill('tbc_pr_comment', 'tbc_pr_comments');
}

export function registerObjectRef(db, type, localId, createdAt = null) {
  ensureObjectRefs(db);
  const existing = db.prepare('SELECT id, type, local_id FROM object_refs WHERE type = ? AND local_id = ?').get(type, localId);
  if (existing) return existing;
  db.prepare('INSERT INTO object_refs (type, local_id, created_at) VALUES (?, ?, COALESCE(?, strftime(\'%Y-%m-%dT%H:%M:%SZ\', \'now\')))')
    .run(type, localId, createdAt);
  return db.prepare('SELECT id, type, local_id FROM object_refs WHERE type = ? AND local_id = ?').get(type, localId);
}

export function extractObjectRefIds(text) {
  return [...new Set([...String(text || '').matchAll(/#(\d+)\b/g)].map(match => Number(match[1])).filter(Number.isFinite))];
}

export function extractFocusedRefIds(text) {
  const ids = new Set(extractObjectRefIds(text).map(String));
  for (const match of String(text || '').matchAll(/\b(?:issue|issues)\s*#?(\d+)\b/gi)) ids.add(`issue:${match[1]}`);
  for (const match of String(text || '').matchAll(/\b(?:tbc\s+pr|pr|prs|pull request|pull requests)\s*#?(\d+)\b/gi)) ids.add(`tbc_pr:${match[1]}`);
  for (const match of String(text || '').matchAll(/\b(?:issue\s+comment|comment|comments)\s*#?(\d+)\b/gi)) ids.add(`comment:${match[1]}`);
  for (const match of String(text || '').matchAll(/\b(?:pr\s+comment|pr\s+comments|tbc\s+pr\s+comment|tbc\s+pr\s+comments)\s*#?(\d+)\b/gi)) ids.add(`tbc_pr_comment:${match[1]}`);
  return [...ids];
}

function issueJson(db, ref) {
  const issue = db.prepare('SELECT * FROM issues WHERE id = ?').get(ref.local_id);
  if (!issue) return null;
  const comments = db.prepare('SELECT * FROM comments WHERE issue_id = ? ORDER BY created_at ASC').all(ref.local_id);
  return { id: ref.id, type: 'issue', local_id: ref.local_id, issue, comments };
}

function prJson(db, ref) {
  const pr = db.prepare('SELECT * FROM tbc_prs WHERE id = ?').get(ref.local_id);
  if (!pr) return null;
  const comments = db.prepare('SELECT * FROM tbc_pr_comments WHERE pr_id = ? ORDER BY created_at ASC').all(ref.local_id);
  return { id: ref.id, type: 'tbc_pr', local_id: ref.local_id, pr, comments };
}

function commentJson(db, ref) {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(ref.local_id);
  if (!comment) return null;
  return { id: ref.id, type: 'comment', local_id: ref.local_id, comment };
}

function prCommentJson(db, ref) {
  const comment = db.prepare('SELECT * FROM tbc_pr_comments WHERE id = ?').get(ref.local_id);
  if (!comment) return null;
  return { id: ref.id, type: 'tbc_pr_comment', local_id: ref.local_id, comment };
}

export function resolveObjectRefJson(db, id) {
  ensureObjectRefs(db);
  const ref = db.prepare('SELECT id, type, local_id FROM object_refs WHERE id = ?').get(id);
  if (!ref) return null;
  if (ref.type === 'issue') return issueJson(db, ref);
  if (ref.type === 'tbc_pr') return prJson(db, ref);
  if (ref.type === 'comment') return commentJson(db, ref);
  if (ref.type === 'tbc_pr_comment') return prCommentJson(db, ref);
  return null;
}

function resolveTypedObjectRefJson(db, type, localId) {
  ensureObjectRefs(db);
  const ref = db.prepare('SELECT id, type, local_id FROM object_refs WHERE type = ? AND local_id = ?').get(type, localId);
  if (!ref) return null;
  if (type === 'issue') return issueJson(db, ref);
  if (type === 'tbc_pr') return prJson(db, ref);
  if (type === 'comment') return commentJson(db, ref);
  if (type === 'tbc_pr_comment') return prCommentJson(db, ref);
  return null;
}

export function resolveReferencedObjectJson(db, text) {
  const resolved = new Map();
  const add = (obj) => { if (obj) resolved.set(`${obj.type}:${obj.local_id}`, obj); };
  const value = String(text || '');

  // Backward compatibility for existing DB text: typed mentions use local table ids.
  for (const match of value.matchAll(/\b(?:issue|issues)\s*#?(\d+)\b/gi)) add(resolveTypedObjectRefJson(db, 'issue', Number(match[1])));
  for (const match of value.matchAll(/\b(?:tbc\s+pr|pr|prs|pull request|pull requests)\s*#?(\d+)\b/gi)) add(resolveTypedObjectRefJson(db, 'tbc_pr', Number(match[1])));
  for (const match of value.matchAll(/\b(?:issue\s+comment|comment|comments)\s*#?(\d+)\b/gi)) add(resolveTypedObjectRefJson(db, 'comment', Number(match[1])));
  for (const match of value.matchAll(/\b(?:pr\s+comment|pr\s+comments|tbc\s+pr\s+comment|tbc\s+pr\s+comments)\s*#?(\d+)\b/gi)) add(resolveTypedObjectRefJson(db, 'tbc_pr_comment', Number(match[1])));

  // Bare #id uses the new global object id namespace.
  for (const id of extractObjectRefIds(value)) add(resolveObjectRefJson(db, id));
  return [...resolved.values()];
}
