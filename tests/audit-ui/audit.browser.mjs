import { spawnSync } from 'node:child_process'
const result = spawnSync('python', ['tests/audit-ui/browser_check.py'], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
