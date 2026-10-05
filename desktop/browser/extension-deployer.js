const fs = require('node:fs');
const path = require('node:path');

/**
 * Compares two semver strings (v1 > v2 => 1, v1 < v2 => -1, equal => 0).
 *
 * @param {string} v1
 * @param {string} v2
 * @returns {number}
 */
function compareSemver(v1, v2) {
  if (!v1 || !v2) return 0;
  const p1 = String(v1).replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const p2 = String(v2).replace(/^v/i, '').split('.').map(x => parseInt(x, 10) || 0);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const num1 = p1[i] ?? 0;
    const num2 = p2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * Checks if a given path is inside a transient mount (e.g. Linux AppImage /tmp/.mount_*).
 *
 * @param {string} [candidatePath]
 * @returns {boolean}
 */
function isTransientMountPath(candidatePath) {
  if (!candidatePath || typeof candidatePath !== 'string') return false;
  const normalized = path.normalize(candidatePath);
  return normalized.includes('/tmp/.mount_') || normalized.includes('\\tmp\\.mount_') || normalized.includes('/tmp/app.asar.unpacked');
}

/**
 * Safely reads and parses manifest.json from a directory.
 *
 * @param {string} extensionDir
 * @param {object} [fsMod=fs]
 * @returns {object | null}
 */
function readExtensionManifest(extensionDir, fsMod = fs) {
  if (!extensionDir || typeof extensionDir !== 'string') return null;
  const manifestPath = path.join(extensionDir, 'manifest.json');
  try {
    if (!fsMod.existsSync(manifestPath)) return null;
    const raw = fsMod.readFileSync(manifestPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Safely copies directory recursively without following external symlinks.
 *
 * @param {string} srcDir
 * @param {string} destDir
 * @param {object} [fsMod=fs]
 */
function safeCopyDirSync(srcDir, destDir, fsMod = fs) {
  fsMod.mkdirSync(destDir, { recursive: true });
  const entries = fsMod.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      safeCopyDirSync(srcPath, destPath, fsMod);
    } else if (entry.isFile()) {
      fsMod.copyFileSync(srcPath, destPath);
    }
    // Ignore symlinks or other special devices to prevent traversal
  }
}

/**
 * Deploys bundled extension to a persistent user directory atomically.
 *
 * @param {object} options
 * @param {string} options.bundledDir Path to bundled extension (e.g. process.resourcesPath/extension or repo/extension)
 * @param {string} options.persistentDir Target persistent path in user profile (e.g. userData/extension)
 * @param {boolean} [options.force=false] Force overwrite regardless of version
 * @param {object} [options.fsModule=fs]
 * @returns {{ ok: boolean, deployed: boolean, path: string, version: string | null, error?: string }}
 */
function deployPersistentExtension(options = {}) {
  const fsMod = options.fsModule || fs;
  const bundledDir = options.bundledDir;
  const persistentDir = options.persistentDir;
  const force = Boolean(options.force);

  if (!bundledDir || !persistentDir) {
    return { ok: false, deployed: false, path: persistentDir || '', version: null, error: 'bundledDir and persistentDir are required' };
  }

  const bundledManifest = readExtensionManifest(bundledDir, fsMod);
  if (!bundledManifest || !bundledManifest.version) {
    return {
      ok: false,
      deployed: false,
      path: persistentDir,
      version: null,
      error: `Bundled extension manifest missing or invalid in ${bundledDir}`,
    };
  }

  // Check if persistent copy already exists and is up to date
  const persistentManifest = readExtensionManifest(persistentDir, fsMod);
  if (persistentManifest && !force) {
    const versionDiff = compareSemver(bundledManifest.version, persistentManifest.version);
    const keyMatches = bundledManifest.key ? (persistentManifest.key === bundledManifest.key) : true;
    if (versionDiff <= 0 && keyMatches) {
      // Already installed and at least as new as bundled version with matching key
      return {
        ok: true,
        deployed: false,
        path: persistentDir,
        version: persistentManifest.version,
      };
    }
  }

  // Atomic deployment via temp directory
  const parentDir = path.dirname(persistentDir);
  try {
    fsMod.mkdirSync(parentDir, { recursive: true });
  } catch (err) {
    return {
      ok: false,
      deployed: false,
      path: persistentDir,
      version: persistentManifest?.version || null,
      error: `Failed to create directory ${parentDir}: ${err.message}`,
    };
  }

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tempDir = path.join(parentDir, `extension.tmp-${uniqueSuffix}`);
  const oldBackupDir = path.join(parentDir, `extension.old-${uniqueSuffix}`);

  try {
    // 1. Copy bundled extension to temp folder
    safeCopyDirSync(bundledDir, tempDir, fsMod);

    // 2. Validate copied manifest
    const tempManifest = readExtensionManifest(tempDir, fsMod);
    if (!tempManifest || !tempManifest.version || (bundledManifest.key && tempManifest.key !== bundledManifest.key)) {
      throw new Error('Copied extension manifest verification failed');
    }

    // 3. Atomic swap
    if (fsMod.existsSync(persistentDir)) {
      fsMod.renameSync(persistentDir, oldBackupDir);
    }

    fsMod.renameSync(tempDir, persistentDir);

    // 4. Cleanup backup
    if (fsMod.existsSync(oldBackupDir)) {
      try {
        fsMod.rmSync(oldBackupDir, { recursive: true, force: true });
      } catch {}
    }

    return {
      ok: true,
      deployed: true,
      path: persistentDir,
      version: tempManifest.version,
    };
  } catch (deployErr) {
    // Cleanup temporary directory if still around
    if (fsMod.existsSync(tempDir)) {
      try {
        fsMod.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }

    // If backup exists and persistentDir is gone, restore backup
    if (fsMod.existsSync(oldBackupDir) && !fsMod.existsSync(persistentDir)) {
      try {
        fsMod.renameSync(oldBackupDir, persistentDir);
      } catch {}
    }

    return {
      ok: false,
      deployed: false,
      path: persistentDir,
      version: persistentManifest?.version || null,
      error: `Atomic extension deployment failed: ${deployErr.message}`,
    };
  }
}

module.exports = {
  compareSemver,
  isTransientMountPath,
  readExtensionManifest,
  safeCopyDirSync,
  deployPersistentExtension,
};
