import { DatabaseSync } from 'node:sqlite';

export const openDb = file => new DatabaseSync(file, { readOnly: true });
export const appleToUnix = date => Number(date) / 1e6 + 978307200000;

export function decodeAttributedBody(value) {
  const buf = Buffer.from(value || []);
  let i = buf.indexOf('NSString');
  if (i < 0) return '';
  i += 8;
  while (i < buf.length && buf[i] !== 0x2b) i++;
  if (++i >= buf.length) return '';
  let length = buf[i++];
  if (length === 0x81 || length === 0x82) {
    const bytes = length === 0x81 ? 2 : 4;
    if (i + bytes > buf.length) return '';
    length = buf.readUIntLE(i, bytes); i += bytes;
  }
  if (i + length > buf.length) return '';
  return buf.subarray(i, i + length).toString('utf8').replace(/\uFFFC/g, '').trim();
}
export function messageText(row) {
  return String(row.text || '').replace(/\uFFFC/g, '').trim() || decodeAttributedBody(row.attributedBody);
}
export function maxRowId(db) {
  return Number(db.prepare('SELECT MAX(ROWID) AS id FROM message').get().id || 0);
}
// Apple nanosecond timestamps exceed JS safe integers; SQLite converts only the date to REAL.
export function readSince(db, cursor, limit = 50) {
  return db.prepare(`SELECT m.ROWID AS rowid, m.guid, m.text, m.attributedBody, CAST(m.date AS REAL) AS date,
    m.service, m.is_audio_message, m.associated_message_type, m.item_type,
    h.id AS sender, c.style,
    (SELECT COUNT(*) FROM chat_handle_join ch WHERE ch.chat_id = c.ROWID) AS participants FROM message m
    JOIN chat_message_join j ON j.message_id = m.ROWID
    JOIN chat c ON c.ROWID = j.chat_id LEFT JOIN handle h ON h.ROWID = m.handle_id
    WHERE m.ROWID > ? AND m.is_from_me = 0
      AND c.style = 45 AND m.service = 'iMessage'
      AND m.associated_message_type = 0 AND m.item_type = 0
      AND (SELECT COUNT(*) FROM chat_handle_join ch WHERE ch.chat_id = c.ROWID) = 1
    ORDER BY m.ROWID LIMIT ?`).all(cursor, limit);
}
export function attachments(db, id) {
  return db.prepare(`SELECT a.filename, a.mime_type, a.uti, a.transfer_state, a.total_bytes
    FROM attachment a JOIN message_attachment_join j ON j.attachment_id = a.ROWID
    WHERE j.message_id = ?`).all(id);
}
export function outgoingError(db, sender) {
  return db.prepare(`SELECT m.error FROM message m JOIN handle h ON h.ROWID = m.handle_id
    WHERE m.is_from_me = 1 AND h.id = ? ORDER BY m.ROWID DESC LIMIT 1`).get(sender)?.error;
}
