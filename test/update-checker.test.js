const test = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateChecker } = require('../desktop/main/update-checker.js');

test('updateChecker: reports up-to-date when versions match', async () => {
  const checker = createUpdateChecker({
    currentVersion: '0.4.0',
    fetchFn: async () => ({
      tag_name: 'v0.4.0',
      html_url: 'https://github.com/pefbrute/boosty-chat-overlay/releases/tag/v0.4.0',
    }),
  });

  const status = await checker.checkForUpdates();
  assert.equal(status.state, 'up-to-date');
  assert.equal(status.updateAvailable, false);
  assert.equal(status.latestVersion, '0.4.0');
});

test('updateChecker: detects update available when remote is higher semver', async () => {
  const checker = createUpdateChecker({
    currentVersion: '0.4.0',
    fetchFn: async () => ({
      tag_name: 'v0.5.0',
      html_url: 'https://github.com/pefbrute/boosty-chat-overlay/releases/tag/v0.5.0',
      body: 'New release notes',
    }),
  });

  const status = await checker.checkForUpdates();
  assert.equal(status.state, 'update-available');
  assert.equal(status.updateAvailable, true);
  assert.equal(status.latestVersion, '0.5.0');
  assert.equal(status.releaseUrl, 'https://github.com/pefbrute/boosty-chat-overlay/releases/tag/v0.5.0');
  assert.equal(status.releaseNotes, 'New release notes');
});

test('updateChecker: handles network failure gracefully without crashing', async () => {
  const checker = createUpdateChecker({
    currentVersion: '0.4.0',
    fetchFn: async () => {
      throw new Error('ENOTFOUND api.github.com');
    },
  });

  const status = await checker.checkForUpdates();
  assert.equal(status.state, 'error');
  assert.equal(status.updateAvailable, false);
  assert.match(status.error, /ENOTFOUND/);
});

test('updateChecker: ignores draft releases', async () => {
  const checker = createUpdateChecker({
    currentVersion: '0.4.0',
    fetchFn: async () => ({
      tag_name: 'v0.9.0',
      draft: true,
    }),
  });

  const status = await checker.checkForUpdates();
  assert.equal(status.state, 'up-to-date');
  assert.equal(status.updateAvailable, false);
});

test('updateChecker: throttles automatic checks within interval', async () => {
  let callCount = 0;
  const checker = createUpdateChecker({
    currentVersion: '0.4.0',
    checkIntervalMs: 60_000,
    fetchFn: async () => {
      callCount++;
      return { tag_name: 'v0.4.0' };
    },
  });

  await checker.checkForUpdates();
  assert.equal(callCount, 1);

  // Immediate second call should be cached
  await checker.checkForUpdates(false);
  assert.equal(callCount, 1);

  // Force call ignores throttle
  await checker.checkForUpdates(true);
  assert.equal(callCount, 2);
});

test('updateChecker: validates release URLs securely', () => {
  const checker = createUpdateChecker({ repo: 'pefbrute/boosty-chat-overlay' });
  assert.equal(checker.validateReleaseUrl('https://github.com/pefbrute/boosty-chat-overlay/releases/tag/v0.5.0'), true);
  assert.equal(checker.validateReleaseUrl('https://github.com/pefbrute/boosty-chat-overlay/releases'), true);
  assert.equal(checker.validateReleaseUrl('https://malicious.site/download'), false);
  assert.equal(checker.validateReleaseUrl('http://github.com/pefbrute/boosty-chat-overlay/releases'), false);
  assert.equal(checker.validateReleaseUrl(''), false);
});
