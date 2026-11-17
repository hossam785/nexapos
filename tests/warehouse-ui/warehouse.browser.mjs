import { createServer } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cacheDir = await mkdtemp(join(tmpdir(), 'warehouse-ui-'))
const server = await createServer({ configFile: false, plugins: [tailwindcss()], cacheDir, optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-dev-runtime', 'react-dom/client', 'lucide-react'] }, resolve: { dedupe: ['react', 'react-dom'] }, server: { host: '127.0.0.1', port: 0, hmr: false }, appType: 'spa' })
try {
  await server.listen()
  const port = server.httpServer.address().port
  const child = spawn('python', ['-B', 'tests/warehouse-ui/warehouse_browser.py', `http://127.0.0.1:${port}/tests/warehouse-ui/index.html`], { stdio: 'inherit' })
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
  if (code !== 0) process.exitCode = code || 1
} finally {
  await server.close()
  await rm(cacheDir, { recursive: true, force: true })
}
