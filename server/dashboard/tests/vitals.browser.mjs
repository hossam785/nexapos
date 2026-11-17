import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const helper = fileURLToPath(new URL('./vitals_browser.py', import.meta.url))
const result = spawnSync('python', [helper], { stdio: 'inherit' })
if (result.error) { console.error(result.error); process.exit(1) }
process.exit(result.status ?? 1)
