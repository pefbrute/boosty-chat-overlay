'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scanForSecrets, sanitizeDom } = require('../scripts/live-e2e/sanitizer.js');

test('scanForSecrets detects forbidden tokens and authorization headers', () => {
  assert.equal(scanForSecrets('<div data-test="CHAT">Привет</div>').ok, true);
  assert.equal(scanForSecrets('Authorization: Bearer abc123xyz').ok, false);
  assert.equal(scanForSecrets('<span token="secret">Text</span>').ok, false);
  assert.equal(scanForSecrets('<img src="cookie-tracker.png" />').ok, false);
  assert.equal(scanForSecrets('session_id=12345').ok, false);
  assert.equal(scanForSecrets('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.jwt').ok, false);
  assert.equal(scanForSecrets('stream_key=live_secret_123').ok, false);
  assert.equal(scanForSecrets('rtmp://vsu.okcdn.ru/input/').ok, false);
});

test('sanitizeDom strips React metadata and tracking attributes', () => {
  const input = `
    <div class="ChatMessage_root" data-test-id="CHATMESSAGE:root" data-reactroot="" data-user-id="987654" data-session="xyz">
      <span data-reactid=".0.1">Hello World</span>
      <img src="https://images.boosty.to/user/avatar.png?sig=abcdef123456" />
      <script>alert(1)</script>
    </div>
  `;
  const sanitized = sanitizeDom(input);
  assert.ok(!sanitized.includes('<script>'));
  assert.ok(!sanitized.includes('data-reactroot'));
  assert.ok(!sanitized.includes('data-user-id'));
  assert.ok(!sanitized.includes('data-session'));
  assert.ok(!sanitized.includes('sig=abcdef123456'));
  assert.ok(sanitized.includes('data-test-id="CHATMESSAGE:root"'));
  assert.ok(sanitized.includes('Hello World'));
  assert.equal(scanForSecrets(sanitized).ok, true);
});
