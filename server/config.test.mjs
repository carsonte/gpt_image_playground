import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('server config', () => {
  it('allows TRUST_PROXY=0 so direct clients cannot spoof proxy headers', () => {
    const result = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      "import('./server/config.mjs').then(({ config }) => console.log(config.trustProxy))",
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ADMIN_PASSWORD: 'test-password',
        SESSION_SECRET: 'test-session-secret',
        STATS_HASH_SECRET: 'test-stats-secret',
        TRUST_PROXY: '0',
      },
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('0')
  })
})
