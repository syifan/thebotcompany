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
  return extractObjectRefIds(text).map(String);
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

function resolveByLocalIdPriority(db, id) {
  ensureObjectRefs(db);
  const priority = ['issue', 'tbc_pr', 'comment', 'tbc_pr_comment'];
  for (const type of priority) {
    const ref = db.prepare('SELECT id, type, local_id FROM object_refs WHERE type = ? AND local_id = ?').get(type, id);
    if (!ref) continue;
    if (type === 'issue') return issueJson(db, ref);
    if (type === 'tbc_pr') return prJson(db, ref);
    if (type === 'comment') return commentJson(db, ref);
    if (type === 'tbc_pr_comment') return prCommentJson(db, ref);
  }
  return resolveObjectRefJson(db, id);
}

export function resolveReferencedObjectJson(db, text) {
  const resolved = new Map();
  for (const id of extractObjectRefIds(text)) {
    const obj = resolveByLocalIdPriority(db, id);
    if (obj) resolved.set(`${obj.type}:${obj.local_id}`, obj);
  }
  return [...resolved.values()];
}
