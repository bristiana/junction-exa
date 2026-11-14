import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export function blob(text, wide = false) {
  const bytes = Buffer.from(text), tag = Buffer.alloc(wide ? 5 : bytes.length >= 128 ? 3 : 1);
  if (wide) { tag[0] = 0x82; tag.writeUInt32LE(bytes.length, 1); }
  else if (bytes.length >= 128) { tag[0] = 0x81; tag.writeUInt16LE(bytes.length, 1); }
  else tag[0] = bytes.length;
  return Buffer.concat([Buffer.from('streamtypedNSString\x01+'), tag, bytes]);
}
export function fixture() {
  const dir = mkdtempSync(fileURLToPath(new URL('./chatdb-', import.meta.url))), file = path.join(dir, 'chat.db');
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE handle (id TEXT, service TEXT);
    CREATE TABLE chat (guid TEXT, style INTEGER, chat_identifier TEXT);
    CREATE TABLE message (guid TEXT, text TEXT, attributedBody BLOB, handle_id INTEGER, is_from_me INTEGER,
      date INTEGER, service TEXT, cache_has_attachments INTEGER, is_audio_message INTEGER,
      associated_message_type INTEGER, item_type INTEGER, error INTEGER);
    CREATE TABLE chat_handle_join (chat_id INTEGER, handle_id INTEGER);
    CREATE TABLE chat_message_join (chat_id INTEGER, message_id INTEGER);
    CREATE TABLE attachment (filename TEXT, mime_type TEXT, uti TEXT, transfer_state INTEGER, total_bytes INTEGER);
    CREATE TABLE message_attachment_join (message_id INTEGER, attachment_id INTEGER);`);
  const handle = db.prepare("INSERT INTO handle VALUES ('judge@icloud.com', 'iMessage')").run().lastInsertRowid;
  const chat = db.prepare("INSERT INTO chat VALUES ('iMessage;-;judge@icloud.com', 45, 'judge@icloud.com')").run().lastInsertRowid;
  db.prepare('INSERT INTO chat_handle_join VALUES (?, ?)').run(chat, handle);
  return { db, file, dir,
    add(options = {}) {
      const row = { guid: crypto.randomUUID(), text: 'Find a sauna', body: null, handle, chat, from: 0,
        date: (Date.now() - 978307200000) * 1e6, service: 'iMessage', audio: 0, associated: 0, item: 0, ...options };
      const id = Number(db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0)').run(
        row.guid, row.text, row.body, row.handle, row.from, row.date, row.service, row.audio, row.associated, row.item).lastInsertRowid);
      db.prepare('INSERT INTO chat_message_join VALUES (?, ?)').run(row.chat, id); return id;
    },
    addHandle(sender) { return Number(db.prepare("INSERT INTO handle VALUES (?, 'iMessage')").run(sender).lastInsertRowid); },
    addChat(style, participants = [handle]) {
      const guid = style === 45 ? 'iMessage;-;fixture' : 'iMessage;+;chat-fixture';
      const id = Number(db.prepare("INSERT INTO chat VALUES (?, ?, '')").run(guid, style).lastInsertRowid);
      for (const participant of participants) db.prepare('INSERT INTO chat_handle_join VALUES (?, ?)').run(id, participant);
      return id;
    },
    attach(id, filename, mime = 'audio/x-caf') {
      const aid = db.prepare("INSERT INTO attachment VALUES (?, ?, '', 5, 0)").run(filename, mime).lastInsertRowid;
      db.prepare('INSERT INTO message_attachment_join VALUES (?, ?)').run(id, aid);
    },
    close() { db.close(); rmSync(dir, { recursive: true, force: true }); }
  };
}
