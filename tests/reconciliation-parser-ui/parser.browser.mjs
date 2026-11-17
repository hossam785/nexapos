import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheDir = await mkdtemp(join(tmpdir(), 'parser-ui-'))
let server
try {
  server = await createServer({ configFile: false, cacheDir, resolve: { dedupe: ['react', 'react-dom'] }, server: { host: '127.0.0.1', port: 0, hmr: false }, appType: 'spa' })
  await server.listen()
  const child = spawn('python', ['-B', 'tests/reconciliation-parser-ui/parser_browser.py', `http://127.0.0.1:${server.httpServer.address().port}/tests/reconciliation-parser-ui/index.html`], { stdio: 'inherit' })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
  if (code !== 0) process.exitCode = code || 1
} finally {
  if (server) await server.close()
  await rm(cacheDir, { recursive: true, force: true })
}
