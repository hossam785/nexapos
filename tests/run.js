#!/usr/bin/env node
// Runs every backend suite (tests/**/*.test.js) with Electron's Node and prints one summary.
//   node tests/run.js                 all suites
//   node tests/run.js sync loyalty    only suites whose path contains one of the words
//   MGPOS_REAL_DB="%APPDATA%\NEXA\mgpos.db" node tests/run.js real   also the suite on a COPY of the shop
const { spawnSync } = require('child_process')
const fs = require('fs'), path = require('path')

const ROOT = path.resolve(__dirname, '..')
const electron = require(path.join(ROOT, 'node_modules', 'electron'))
const filters = process.argv.slice(2)
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.test.js') ? [path.join(d, e.name)] : []))
const suites = walk(__dirname).sort().filter((f) => !filters.length || filters.some((w) => f.includes(w)))

let failed = 0, checks = 0
for (const suite of suites) {
  const rel = path.relative(ROOT, suite)
  const started = Date.now()
  const res = spawnSync(electron, [suite], { cwd: ROOT, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = `${res.stdout || ''}${res.stderr || ''}`
  const passed = out.match(/ALL (\d+) CHECKS PASSED/)
  const skipped = out.match(/SKIPPED: (.*)/)
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  if (skipped) console.log(`SKIP  ${rel}  (${skipped[1]})`)
  else if (res.status === 0 && passed) { checks += Number(passed[1]); console.log(`PASS  ${rel}  ${passed[1]} checks  ${secs}s`) }
  else { failed++; console.log(`FAIL  ${rel}  ${secs}s\n${out.split('\n').filter((l) => !l.startsWith('  PASS')).slice(-25).join('\n')}`) }
}
console.log(`\n${suites.length} suites, ${checks} checks passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
