#!/usr/bin/env node

/**
 * Unified Pre-Completion Verification Runner (Preflight Gate)
 * Enforces the mandatory Section 4 verification pipeline from AGENTS.md:
 *  1. Syntax check (npm run check)
 *  2. Unit, helper, and resilience test suites (npm test)
 *  3. Real Electron integration tests (npm run test:integration)
 *  4. Electron Desktop Visual UI tests (npm run test:ui:visual)
 *  5. Whitespace and Git formatting check (git diff --check)
 *
 * Options:
 *  --fast          Skip Electron integration & visual tests (syntax + unit + git diff)
 *  --skip-visual   Skip visual UI tests (syntax + unit + integration + git diff)
 *  --help, -h      Display usage information
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/verify-preflight.js [options]

Options:
  --fast          Quick check: syntax + unit tests + git diff (skips Electron UI/integration)
  --skip-visual   Skip visual UI tests, run syntax + unit + integration + git diff
  --help, -h      Show this message
`);
  process.exit(0);
}

const isFast = args.includes('--fast');
const skipVisual = args.includes('--skip-visual') || isFast;

const steps = [
  {
    name: '1. Syntax Verification',
    command: 'npm',
    args: ['run', 'check'],
    enabled: true,
  },
  {
    name: '2. Unit, Helpers & Resilience Tests',
    command: 'npm',
    args: ['test'],
    enabled: true,
  },
  {
    name: '3. Electron Integration Tests',
    command: 'npm',
    args: ['run', 'test:integration'],
    enabled: !isFast,
  },
  {
    name: '4. Desktop UI Visual Tests',
    command: 'npm',
    args: ['run', 'test:ui:visual'],
    enabled: !skipVisual,
  },
  {
    name: '5. Git Diff Formatting & Whitespace Check',
    command: 'git',
    args: ['diff', '--check'],
    enabled: true,
  },
];

console.log('='.repeat(65));
console.log('       BOOSTY CHAT OVERLAY — MANDATORY PREFLIGHT GATE');
console.log('='.repeat(65));
console.log(`Mode: ${isFast ? 'FAST (headless)' : skipVisual ? 'SKIP-VISUAL' : 'FULL (standard)'}`);
console.log(`Root: ${ROOT_DIR}\n`);

const results = [];
let overallPass = true;

for (const step of steps) {
  if (!step.enabled) {
    results.push({ name: step.name, status: 'SKIPPED', duration: 0 });
    continue;
  }

  console.log(`\n▶ Running: ${step.name}...`);
  console.log(`  $ ${step.command} ${step.args.join(' ')}`);

  const startTime = Date.now();
  const proc = spawnSync(step.command, step.args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    env: { ...process.env },
  });
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  if (proc.status === 0) {
    console.log(`✔ ${step.name} PASSED (${duration}s)`);
    results.push({ name: step.name, status: 'PASS', duration });
  } else {
    console.error(`✖ ${step.name} FAILED with exit code ${proc.status} (${duration}s)`);
    results.push({ name: step.name, status: 'FAIL', duration });
    overallPass = false;
    break; // Fail-fast: stop on first failure to save developer time
  }
}

console.log('\n' + '='.repeat(65));
console.log('                  PREFLIGHT VERIFICATION SUMMARY');
console.log('='.repeat(65));

for (const res of results) {
  const icon = res.status === 'PASS' ? '✔' : res.status === 'SKIPPED' ? '↷' : '✖';
  const paddedName = res.name.padEnd(46, ' ');
  const paddedStatus = res.status.padEnd(8, ' ');
  console.log(`${icon}  ${paddedName} [${paddedStatus}] ${res.duration > 0 ? `(${res.duration}s)` : ''}`);
}

console.log('='.repeat(65));

if (overallPass) {
  console.log('✨ ALL PREFLIGHT CHECKS PASSED CLEANLY! Ready for commit/release.');
  process.exit(0);
} else {
  console.error('❌ PREFLIGHT CHECKS FAILED. Please review the errors above.');
  process.exit(1);
}
