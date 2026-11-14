import path from 'node:path';
import { homedir } from 'node:os';
import { createBridge } from './bridge.mjs';
import { makeApi } from '../api.mjs';

// Constructing is inert. Only an explicit toggle or a previously enabled setting opens the database.
export function makeMessageBridge({ getConfig, save, safeStorage, onStatus, fetchImpl, dbPath = path.join(homedir(), 'Library', 'Messages', 'chat.db'), script, send }) {
  const config = getConfig();
  const settings = config.imessage ||= {};
  return createBridge({
    dbPath, settings, save, onStatus, script, send,
    log: (...metadata) => console.info('iMessage', ...metadata),
    api: token => {
      const config = getConfig();
      if (settings.backendUrl && settings.backendUrl !== config.backendUrl) throw new Error('Restore the linked iMessage server before using the bridge.');
      settings.backendUrl ||= config.backendUrl;
      return makeApi({ baseUrl: config.backendUrl, token, fetchImpl });
    },
    encrypt: token => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Unlock your login keychain before linking iMessage.');
      return safeStorage.encryptString(token).toString('base64');
    },
    decrypt: sealed => safeStorage.decryptString(Buffer.from(sealed, 'base64'))
  });
}
