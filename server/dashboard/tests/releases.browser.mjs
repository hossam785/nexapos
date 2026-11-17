import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const result = spawnSync('python', [fileURLToPath(new URL('./releases_browser.py', import.meta.url))], { stdio: 'inherit' })
if (result.error) { console.error(result.error); process.exit(1) }
process.exit(result.status ?? 1)
