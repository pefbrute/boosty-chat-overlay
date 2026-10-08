const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8'));

test('Release Security Invariants: Repository Hygiene', () => {
  // Check no accidental .env or certificates committed to repo root
  const forbiddenFiles = ['.env', '.env.local', '.env.production', 'cert.pfx', 'cert.pem', 'private.key'];
  for (const f of forbiddenFiles) {
    const fullPath = path.join(PROJECT_ROOT, f);
    assert.strictEqual(fs.existsSync(fullPath), false, `Forbidden file ${f} must not exist in repository root`);
  }
});

test('Release Security Invariants: Extension RSA Public Key is Non-Secret', () => {
  const manifestPath = path.join(PROJECT_ROOT, 'extension', 'manifest.json');
  assert.strictEqual(fs.existsSync(manifestPath), true, 'manifest.json must exist');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(manifest.key, 'manifest.json must declare fixed extension key for deterministic ID');
  // Check that key is an X.509 SubjectPublicKeyInfo (DER base64) starting with MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8
  assert.ok(manifest.key.startsWith('MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8'), 'manifest key must be a valid public RSA key');
});

test('Release Security Invariants: Local-First Transport & Zero Telemetry', () => {
  const serverPath = path.join(PROJECT_ROOT, 'server.js');
  const serverCode = fs.readFileSync(serverPath, 'utf8');

  // Verify server binds to 127.0.0.1
  assert.match(serverCode, /const\s+host\s*=\s*['"]127\.0\.0\.1['"]/, 'Server must bind strictly to localhost 127.0.0.1');

  // Verify absence of telemetry endpoints
  assert.strictEqual(serverCode.includes('google-analytics.com'), false);
  assert.strictEqual(serverCode.includes('segment.io'), false);
  assert.strictEqual(serverCode.includes('mixpanel.com'), false);
});

test('Release Security Invariants: Production Dependencies Isolation', () => {
  const dependencies = Object.keys(pkg.dependencies || {});
  // Production dependencies must be strictly limited to local websocket adapters
  assert.deepStrictEqual(dependencies.sort(), ['obs-websocket-js', 'ws'].sort(), 'Production dependencies must only include obs-websocket-js and ws');

  // Remotion and Playwright must be devDependencies only
  const devDeps = Object.keys(pkg.devDependencies || {});
  assert.strictEqual(dependencies.includes('remotion'), false, 'Remotion must not be in dependencies');
  assert.strictEqual(dependencies.includes('playwright'), false, 'Playwright must not be in dependencies');
  assert.ok(devDeps.includes('playwright'), 'Playwright is development dependency');
});

test('Release Security Invariants: Package Version Consistency', () => {
  assert.ok(pkg.version, 'package.json must declare version');
  const versionRegex = /^\d+\.\d+\.\d+$/;
  assert.match(pkg.version, versionRegex, 'Package version must be semver compliant');

  // Check SHA256SUMS.txt if present in dist
  const sumsPath = path.join(PROJECT_ROOT, 'dist', 'SHA256SUMS.txt');
  if (fs.existsSync(sumsPath)) {
    const content = fs.readFileSync(sumsPath, 'utf8');
    assert.match(content, new RegExp(`Boosty Chat Overlay Setup ${pkg.version}\\.exe`), 'SHA256SUMS.txt must match package version');
  }
});
