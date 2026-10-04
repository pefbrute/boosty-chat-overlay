'use strict';

/**
 * Sanitizes Boosty Chat DOM nodes and ensures zero secrets are saved.
 */

const SENSITIVE_PATTERNS = [
  /authorization/i,
  /bearer/i,
  /\bjwt\b/i,
  /token/i,
  /cookie/i,
  /session/i,
  /password/i,
  /stream[_-]?key/i,
  /rtmp:\/\//i,
  /live_key/i,
];

/**
 * Performs a strict security scan on HTML/text content.
 * Throws or returns error if any suspicious authentication or token pattern is found.
 *
 * @param {string} content
 * @returns {{ ok: boolean, violation?: string }}
 */
function scanForSecrets(content) {
  if (typeof content !== 'string') return { ok: true };

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(content)) {
      return {
        ok: false,
        violation: `Detected prohibited pattern: ${pattern.toString()}`,
      };
    }
  }

  return { ok: true };
}

/**
 * Strips internal attributes, scripts, user tracking IDs, and sensitive tokens from DOM HTML string.
 *
 * @param {string} rawHtml
 * @returns {string}
 */
function sanitizeDom(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';

  let sanitized = rawHtml;

  // 1. Remove script tags completely
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // 2. Remove style tags if any
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // 3. Remove React internal attributes (__reactFiber, __reactProps, etc.)
  sanitized = sanitized.replace(/\sdata-react[a-z0-9_-]*="[^"]*"/gi, '');
  sanitized = sanitized.replace(/\sreact-[a-z0-9_-]*="[^"]*"/gi, '');

  // 4. Remove tracking, analytics, and session data attributes
  sanitized = sanitized.replace(/\sdata-(?:session|token|auth|analytics|track|user-id|profile-id|fingerprint)="[^"]*"/gi, '');

  // 5. Clean up query params from image URLs (e.g. signature tokens or expiration timestamps)
  sanitized = sanitized.replace(/(src="https?:\/\/[^"?]+)\?[^"]*"/gi, '$1"');
  sanitized = sanitized.replace(/(srcset="https?:\/\/[^"?]+)\?[^"\s]*/gi, '$1');

  // 6. Clean up trailing spaces in tags
  sanitized = sanitized.replace(/\s+>/g, '>');

  return sanitized.trim();
}

/**
 * Scans all text artifacts in a directory for prohibited secrets.
 *
 * @param {string} reportDir
 * @returns {{ filesScanned: number, leaksFound: number, violations: Array<string> }}
 */
function scanArtifactsForSecrets(reportDir) {
  const fs = require('node:fs');
  const path = require('node:path');
  if (!fs.existsSync(reportDir)) return { filesScanned: 0, leaksFound: 0, violations: [] };
  const files = fs.readdirSync(reportDir);
  const textExtensions = ['.json', '.html', '.txt', '.log'];
  let filesScanned = 0;
  const violations = [];

  for (const f of files) {
    const fullPath = path.join(reportDir, f);
    if (fs.statSync(fullPath).isDirectory()) {
      const sub = scanArtifactsForSecrets(fullPath);
      filesScanned += sub.filesScanned;
      violations.push(...sub.violations);
      continue;
    }
    if (textExtensions.some(ext => f.endsWith(ext))) {
      filesScanned++;
      const content = fs.readFileSync(fullPath, 'utf8');
      const check = scanForSecrets(content);
      if (!check.ok) {
        violations.push(`${f}: ${check.violation}`);
      }
    }
  }

  if (violations.length > 0) {
    throw new Error(`Security violation detected in artifacts:\n${violations.join('\n')}`);
  }

  return { filesScanned, leaksFound: 0, violations: [] };
}

module.exports = {
  SENSITIVE_PATTERNS,
  scanForSecrets,
  sanitizeDom,
  scanArtifactsForSecrets,
};
