'use strict';

/**
 * Syntax check: runs `node --check` on every .js/.mjs file in the project
 * (excluding node_modules and .git). Exits non-zero on the first failure.
 *
 * Files under worker/ are ES modules (worker/package.json has
 * "type":"module"); node --check uses the nearest package.json to pick the
 * right module mode, so both CJS and ESM files validate correctly.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler']);

/** @returns {string[]} */
function collect(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collect(path.join(dir, entry.name)));
    } else if (/\.(js|mjs)$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function main() {
  const files = collect(ROOT).sort();
  // Strip the sandbox's stale NODE_OPTIONS preload from child processes.
  const env = { ...process.env };
  delete env.NODE_OPTIONS;

  let failures = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const res = spawnSync(process.execPath, ['--check', file], {
      env,
      encoding: 'utf8',
    });
    if (res.status === 0) {
      console.log(`  ok    ${rel}`);
    } else {
      failures++;
      console.error(`  FAIL  ${rel}`);
      if (res.stderr) console.error(res.stderr.trim());
    }
  }

  console.log(`\nChecked ${files.length} file(s), ${failures} failure(s).`);
  if (failures > 0) process.exit(1);
}

main();
