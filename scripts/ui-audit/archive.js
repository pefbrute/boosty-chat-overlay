'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function generateReadme({ manifest }) {
  const { generatedAt, appVersion, git, screenshots, screenshotCount } = manifest;

  const lines = [
    '# Boosty Chat Overlay — UI/UX Audit Bundle',
    '',
    `**Generated:** ${generatedAt}  `,
    `**App Version:** ${appVersion}  `,
    `**Branch:** \`${git.branch}\`  `,
    `**Commit:** \`${git.commit}\`${git.dirty ? ' *(dirty)*' : ''}  `,
    `**Screenshots:** ${screenshotCount}  `,
    '',
    '## Browsing Screenshots',
    '',
    'Open `contact-sheet.html` in your browser to view all screenshots with metadata in a visual gallery.',
    '',
    '## Screenshot Manifest',
    '',
    '| # | State | Section | Resolution | Description | File |',
    '|:--|:------|:--------|:-----------|:------------|:-----|',
  ];

  screenshots.forEach(s => {
    lines.push(`| ${s.index} | \`${s.state}\` | ${s.section} | ${s.width}×${s.height} | ${s.description} | [${s.file.replace('screenshots/', '')}](${s.file}) |`);
  });

  lines.push('');
  lines.push('---');
  lines.push('*Automated deterministic capture bundle. No user credentials, tokens, or external services involved.*');
  lines.push('');

  return lines.join('\n');
}

/**
 * Packs the capture folder into a zip located OUTSIDE the capture folder.
 * targetDir: artifacts/ui-audit/2026-09-14_17-40-00
 * zipPath:   artifacts/ui-audit/ui-audit-2026-09-14_17-40-00.zip
 */
function createArchive(targetDir, zipPath) {
  const parentDir = path.dirname(targetDir);
  const folderName = path.basename(targetDir);

  if (fs.existsSync(zipPath)) {
    try { fs.unlinkSync(zipPath); } catch {}
  }

  // Use zip -r from parent directory to create a clean archive
  execSync(`zip -r "${zipPath}" "${folderName}"`, {
    cwd: parentDir,
    stdio: 'ignore',
  });

  return zipPath;
}

module.exports = {
  generateReadme,
  createArchive,
};
