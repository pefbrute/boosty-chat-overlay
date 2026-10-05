'use strict';

/**
 * Browser Extension & Release Identity Constants.
 *
 * CRITICAL / RELEASE IDENTITY INVARIANT:
 * DO NOT ROTATE THIS KEY OR ID!
 * The 2048-bit RSA SPKI public key in extension/manifest.json deterministically produces
 * the stable extension ID: 'bcoadgccgjomlcadhmeognidaoocohdp' across all Chromium browsers (Chrome, Brave, Edge).
 *
 * Rotating this key or altering the manifest public key changes the extension ID,
 * breaks the upgrade path for existing users, resets browser permissions, and prevents
 * automated reconnects and health telemetry.
 */
const EXPECTED_EXTENSION_ID = 'bcoadgccgjomlcadhmeognidaoocohdp';

module.exports = {
  EXPECTED_EXTENSION_ID,
};
