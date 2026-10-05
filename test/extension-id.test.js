const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

/**
 * Computes Chromium extension ID from base64-encoded SPKI public key.
 *
 * @param {string} base64Key
 * @returns {string} 32-character extension ID using letters a-p
 */
function computeExtensionIdFromKey(base64Key) {
  const der = Buffer.from(base64Key, 'base64');
  const hash = crypto.createHash('sha256').update(der).digest();
  let id = '';
  for (let i = 0; i < 16; i++) {
    const byte = hash[i];
    id += String.fromCharCode(97 + ((byte >> 4) & 0x0f));
    id += String.fromCharCode(97 + (byte & 0x0f));
  }
  return id;
}

test('extension manifest contains valid stable public key producing deterministic ID', () => {
  const manifestPath = path.join(__dirname, '..', 'extension', 'manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(manifest.key, 'manifest must contain "key" field');
  assert.strictEqual(typeof manifest.key, 'string');
  assert.ok(manifest.key.length > 100, 'manifest.key must be a valid base64 SPKI key');

  const computedId = computeExtensionIdFromKey(manifest.key);
  assert.strictEqual(computedId, 'bcoadgccgjomlcadhmeognidaoocohdp', 'extension ID must be stable and match canonical project ID');
});

module.exports = {
  computeExtensionIdFromKey,
};
