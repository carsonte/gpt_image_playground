import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const env = {
  ...process.env,
  UPSTREAM_API_URL: 'https://primary.example/v1',
  UPSTREAM_API_KEY: 'primary-secret-value',
  SIXONER_API_URL: 'https://sixoner.example/v1',
  SIXONER_API_KEY: 'sixoner-secret-value',
  CATAPI_API_URL: 'https://catapi.example/v1',
  CATAPI_API_KEY: 'catapi-secret-value',
}

function run(args, overrides = {}) {
  return spawnSync(process.execPath, ['scripts/real-image-smoke.mjs', ...args], {
    cwd: process.cwd(),
    env: { ...env, ...overrides },
    encoding: 'utf8',
  })
}

describe('real image smoke CLI', () => {
  it('is a non-networking dry-run by default and shows all paid request parameters', () => {
    const result = run([])
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      dryRun: true,
      tier: '4K',
      size: '3840x2160',
      quality: 'high',
      outputFormat: 'png',
      imageCount: 1,
      stream: false,
    })
    expect(result.stdout).not.toContain('secret-value')
  })

  it.each([
    [['--tier=2kk'], 'tier 仅支持 2K 或 4K'],
    [['--channels='], 'channels 不能为空'],
    [['--channels=primary,primary'], 'channels 不能包含重复线路'],
    [['--channels=catapi,'], 'channels 不能包含空线路'],
    [['--channels=unknown'], '未知线路：unknown'],
    [['--channel=catapi'], '未知参数：--channel=catapi'],
    [['--tier=2K', '--tier=4K'], '同一参数不能重复传入'],
  ])('rejects unsafe arguments', (args, message) => {
    const result = run(args)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(message)
  })

  it('fails when any requested channel is missing configuration', () => {
    const result = run(['--channels=primary,catapi'], { CATAPI_API_KEY: '' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('线路配置不完整：catapi')
  })
})
