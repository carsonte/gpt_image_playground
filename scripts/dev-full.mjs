import { spawn } from 'node:child_process'

const env = {
  ...process.env,
  VITE_SERVER_MANAGED_API: 'true',
  VITE_DEFAULT_API_URL: 'https://proxy?model=gpt-image-2&apiMode=images',
  VITE_API_PROXY_AVAILABLE: 'true',
  VITE_API_PROXY_LOCKED: 'true',
  VITE_SHOW_PRESET_CONFIG_ONLY: 'true',
  VITE_LOCK_PRESET_CONFIG_PARAMS: 'true',
  VITE_PREVENT_PRESET_CONFIG_DELETION: 'true',
}

const children = [
  spawn(process.execPath, ['--env-file-if-exists=.env.server.local', '--watch', 'server/index.mjs'], { env, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { env, stdio: 'inherit' }),
]

let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 500).unref()
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!stopping && code) stop(code)
  })
}

process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
