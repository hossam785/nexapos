import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--group' || !['header', 'product', 'invoice'].includes(args[1]))) {
  throw new Error('Usage: node migration.browser.mjs [--group header|product|invoice]')
}
const started = performance.now()
const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`
const cacheDir = await mkdtemp(join(tmpdir(), 'tax-migration-ui-'))
let server
console.log(`Harness: created fresh cache; starting Vite (${elapsed()})`)
try {
  server = await createServer({ configFile: false, cacheDir, resolve: { dedupe: ['react', 'react-dom'] }, server: { host: '127.0.0.1', port: 0, hmr: false }, appType: 'spa' })
  await server.listen()
  const url = `http://127.0.0.1:${server.httpServer.address().port}/tests/tax-migration-ui/index.html`
  console.log(`Harness: Vite ready at ${url} (${elapsed()})`)
  const child = spawn('python', ['-B', 'tests/tax-migration-ui/migration_browser.py', url, ...args], { stdio: 'inherit' })
  let stopping = false
  const stopChild = reason => {
    if (stopping || child.exitCode !== null || child.signalCode !== null) return
    stopping = true
    process.exitCode = 1
    console.error(`Harness: stopping owned worker ${child.pid}: ${reason} (${elapsed()})`)
    if (process.platform === 'win32' && child.pid) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'inherit' })
      killer.on('error', error => console.error(`Harness: taskkill failed: ${error.message}`))
    } else child.kill('SIGTERM')
  }
  const watchdog = setTimeout(() => stopChild('10-minute watchdog'), 600000)
  const onInterrupt = () => stopChild('interrupted')
  process.once('SIGINT', onInterrupt)
  process.once('SIGTERM', onInterrupt)
  let result
  try {
    result = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve({ code, signal }))
    })
  } finally {
    clearTimeout(watchdog)
    process.removeListener('SIGINT', onInterrupt)
    process.removeListener('SIGTERM', onInterrupt)
    stopChild('runner cleanup')
  }
  console.log(`Harness: browser child exit code=${result.code} signal=${result.signal} (${elapsed()})`)
  if (result.code !== 0) process.exitCode = 1
} finally {
  console.log(`Harness: cleaning up Vite and cache (${elapsed()})`)
  try {
    if (server) await server.close()
  } finally {
    await rm(cacheDir, { recursive: true, force: true })
  }
  console.log(`Harness: cleanup complete (${elapsed()})`)
}
