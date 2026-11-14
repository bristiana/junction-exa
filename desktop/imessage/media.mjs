import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, realpath, readFile, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { letterType, MAX_VOICE_BYTES } from '../logic.mjs';
const execute = promisify(execFile);
const wait = ms => new Promise(r => setTimeout(r, ms));
export const expandPath = file => file?.startsWith('~/') ? path.join(homedir(), file.slice(2)) : file;
export async function readyAttachment(attachment, { sleep = wait, attachmentRoot = path.join(homedir(), 'Library', 'Messages', 'Attachments') } = {}) {
  const file = expandPath(attachment.filename);
  if (!file || !path.isAbsolute(file)) throw new Error('Attachment unavailable.');
  const root = await realpath(attachmentRoot);
  let previous = -1;
  for (let i = 0; i < 15; i++) {
    const resolved = await realpath(file).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (resolved && !isAttachmentPath(root, resolved)) throw new Error('Attachment outside Attachments directory.');
    const info = resolved && await stat(resolved).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    const size = info?.isFile() ? info.size : 0;
    if (size > MAX_VOICE_BYTES) throw new Error('Attachment is too large.');
    if (size > 0 && size === previous && (!attachment.total_bytes || size >= attachment.total_bytes)) return resolved;
    previous = size; await sleep(1000);
  }
  throw new Error('Attachment is not downloaded yet. Please send it again.');
}
export async function convertVoice(file, { run = execute, tempRoot = tmpdir() } = {}) {
  const dir = await mkdtemp(path.join(tempRoot, 'vali-voice-'));
  try {
    const output = path.join(dir, 'voice.m4a');
    await run('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', file, output], { timeout: 20000 });
    return voiceBytes(await readFile(output));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

function isAttachmentPath(root, file) {
  const relative = path.relative(root, file);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function voiceBytes(bytes) {
  if (!bytes?.byteLength || bytes.byteLength > MAX_VOICE_BYTES) throw new Error('Invalid voice size.');
  return bytes;
}
export async function readLetter(file, mime) {
  const type = letterType({ name: file, type: mime, size: (await stat(file)).size });
  if (type.error) throw new Error(type.error);
  const bytes = await readFile(file);
  const checked = letterType({ name: file, type: type.mime, size: bytes.byteLength });
  if (checked.error || !bytes.byteLength) throw new Error(checked.error || 'That file is empty.');
  return { bytes, mime: checked.mime };
}
