#!/usr/bin/env node

/**
 * Windows VM ("Winda") Helper & Artifact Deployment CLI
 *
 * Commands:
 *   status    - Check VM running state, Guest Additions, and shared folder paths
 *   deploy    - Copy the latest installer .exe to VM shared folder (/home/fedor/winda-share/releases/)
 *   defender  - Generate / trigger Microsoft Defender CLI scan commands
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const VM_NAME = 'Winda';
const SHARED_DIR = '/home/fedor/winda-share';
const RELEASES_DIR = path.join(SHARED_DIR, 'releases');
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const DIST_DIR = path.join(PROJECT_ROOT, 'dist');

const command = process.argv[2] || 'status';

function computeSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return hash.digest('hex');
}

function getVmStatus() {
  try {
    const raw = execSync(`VBoxManage showvminfo "${VM_NAME}" --machinereadable`, { encoding: 'utf8' });
    const stateMatch = raw.match(/^VMState="([^"]+)"/m);
    const guestAdditionsMatch = raw.match(/^GuestAdditionsVersion="([^"]+)"/m);
    return {
      exists: true,
      state: stateMatch ? stateMatch[1] : 'unknown',
      guestAdditions: guestAdditionsMatch ? guestAdditionsMatch[1] : 'unknown',
    };
  } catch (err) {
    return { exists: false, error: err.message };
  }
}

switch (command) {
  case 'status': {
    console.log(`\n=== VirtualBox VM [${VM_NAME}] Status ===`);
    const vm = getVmStatus();
    if (!vm.exists) {
      console.error(`VM "${VM_NAME}" not found or VBoxManage unavailable.`);
      process.exit(1);
    }
    console.log(`State:           ${vm.state === 'running' ? '🟢 running' : '⚪ ' + vm.state}`);
    console.log(`Guest Additions: ${vm.guestAdditions}`);
    console.log(`Shared Folder:   ${SHARED_DIR} (${fs.existsSync(SHARED_DIR) ? 'доступна' : 'отсутствует'})`);
    console.log(`Releases Target: ${RELEASES_DIR}`);

    if (fs.existsSync(RELEASES_DIR)) {
      const files = fs.readdirSync(RELEASES_DIR).filter(f => f.endsWith('.exe'));
      console.log(`Existing Exe in VM: ${files.length} файлов`);
      files.slice(-3).forEach(f => console.log(`  - ${f}`));
    }
    break;
  }

  case 'deploy': {
    console.log(`\n=== Deploy Installer to [${VM_NAME}] Shared Folder ===`);
    if (!fs.existsSync(RELEASES_DIR)) {
      fs.mkdirSync(RELEASES_DIR, { recursive: true });
    }

    // Look for installer in dist/ or target argument
    let targetExe = process.argv[3];
    if (!targetExe) {
      if (fs.existsSync(DIST_DIR)) {
        const distFiles = fs.readdirSync(DIST_DIR)
          .filter(f => f.endsWith('.exe'))
          .map(f => ({ name: f, path: path.join(DIST_DIR, f), time: fs.statSync(path.join(DIST_DIR, f)).mtimeMs }))
          .sort((a, b) => b.time - a.time);

        if (distFiles.length > 0) {
          targetExe = distFiles[0].path;
        }
      }
    }

    if (!targetExe || !fs.existsSync(targetExe)) {
      console.error(`No executable installer found in dist/ or provided path.`);
      console.log(`Tip: build the installer first via GitHub Actions or electron-builder.`);
      process.exit(1);
    }

    const fileName = path.basename(targetExe);
    const destPath = path.join(RELEASES_DIR, fileName);
    console.log(`Source:      ${targetExe}`);
    console.log(`Destination: ${destPath}`);

    fs.copyFileSync(targetExe, destPath);
    const sha256 = computeSha256(destPath);
    const sizeMb = (fs.statSync(destPath).size / (1024 * 1024)).toFixed(2);

    console.log(`\n✔ File deployed successfully!`);
    console.log(`Size:   ${sizeMb} MB`);
    console.log(`SHA256: ${sha256}`);

    // Update SHA256SUMS.txt
    const sumsPath = path.join(RELEASES_DIR, 'SHA256SUMS.txt');
    fs.writeFileSync(sumsPath, `${sha256}  ${fileName}\n`, 'utf8');
    console.log(`✔ Updated: ${sumsPath}`);
    break;
  }

  case 'defender': {
    console.log(`\n=== Microsoft Defender Verification Guide for [${VM_NAME}] ===`);
    console.log(`Inside Windows 11 PowerShell (Administrator), run:`);
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`cd E:\\releases  # or cd \\\\VBOXSVR\\qa-share\\releases`);
    console.log(`Get-FileHash -Algorithm SHA256 .\\*.exe`);
    console.log(``);
    console.log(`# 1. Update Defender definitions`);
    console.log(`& "C:\\Program Files\\Windows Defender\\MpCmdRun.exe" -SignatureUpdate`);
    console.log(``);
    console.log(`# 2. Scan installer executable`);
    console.log(`& "C:\\Program Files\\Windows Defender\\MpCmdRun.exe" -Scan -ScanType 3 -File "E:\\releases\\Boosty Chat Overlay Setup 0.5.2.exe"`);
    console.log(``);
    console.log(`# 3. Scan installed application directory`);
    console.log(`& "C:\\Program Files\\Windows Defender\\MpCmdRun.exe" -Scan -ScanType 3 -File "$env:LOCALAPPDATA\\Programs\\boosty-chat-overlay"`);
    console.log(`--------------------------------------------------------------------------------`);
    break;
  }

  default:
    console.log(`Unknown command: ${command}`);
    console.log(`Available commands: status, deploy, defender`);
    process.exit(1);
}
