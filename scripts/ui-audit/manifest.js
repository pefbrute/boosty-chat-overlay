'use strict';

const { execSync } = require('node:child_process');

function getGitMetadata() {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const fullCommit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const status = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    const dirty = status.length > 0;
    return { branch, commit, fullCommit, dirty };
  } catch {
    return { branch: 'unknown', commit: 'unknown', fullCommit: 'unknown', dirty: false };
  }
}

function buildManifest({ appVersion, platform, screenshots, timestamp }) {
  const git = getGitMetadata();
  return {
    generatedAt: timestamp || new Date().toISOString(),
    appVersion: appVersion || '0.4.0',
    platform: platform || process.platform,
    git,
    screenshotCount: screenshots.length,
    screenshots: screenshots.map((item, idx) => ({
      index: item.index || idx + 1,
      file: `screenshots/${item.filename}`,
      section: item.section,
      state: item.id || item.state,
      width: item.width,
      height: item.height,
      description: item.description,
      status: item.status || 'success',
      error: item.error || null,
    })),
  };
}

module.exports = {
  getGitMetadata,
  buildManifest,
};
