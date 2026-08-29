import { describe, expect, it } from 'vitest'
import {
  RECOMMENDED_AUTO_FALLBACK_ON_MISMATCH,
  RECOMMENDED_GPT_ROUTES,
  RECOMMENDED_STREAM_ENABLED,
  cloneGptRoutes,
  getRouteList,
  migrateStoredGptRoutes,
  normalizeGptRoutes,
  normalizeStreamEnabled,
  normalizeStreamMode,
  normalizeSubmittedGptRoutes,
  routesFromLegacyChannel,
  streamEnabledFromLegacyMode,
  streamModeFromEnabled,
} from './gptRouting.mjs'

describe('GPT routing settings', () => {
  it('provides four independent recommended route groups', () => {
    const routes = normalizeGptRoutes(RECOMMENDED_GPT_ROUTES)
    expect(routes).toEqual({
      generate: { '2K': ['sixoner', 'catapi', 'primary'], '4K': ['sixoner', 'catapi', 'primary'] },
      edit: { '2K': ['sixoner', 'catapi', 'primary'], '4K': ['sixoner', 'catapi', 'primary'] },
    })
    routes.generate['2K'].reverse()
    expect(RECOMMENDED_GPT_ROUTES.generate['2K']).toEqual(['sixoner', 'catapi', 'primary'])
  })

  it('normalizes legacy two-tier objects into both actions', () => {
    const routes = normalizeGptRoutes({ '2K': ['primary', 'catapi'], '4K': ['catapi'] })
    expect(routes.generate['2K']).toEqual(['primary', 'catapi'])
    expect(routes.edit['4K']).toEqual(['catapi'])
    expect(getRouteList(routes, 'edit', '4K')).toEqual(['catapi'])
  })

  it('rejects invalid or duplicate submitted routes while allowing BlackEngine first', () => {
    const valid = cloneGptRoutes(RECOMMENDED_GPT_ROUTES)
    valid.generate['4K'] = ['primary', 'sixoner']
    expect(normalizeSubmittedGptRoutes(valid).generate['4K']).toEqual(['primary', 'sixoner'])

    const duplicate = cloneGptRoutes(valid)
    duplicate.generate['4K'] = ['primary', 'primary']
    expect(() => normalizeSubmittedGptRoutes(duplicate)).toThrow(/无效或重复/)

    const invalid = cloneGptRoutes(valid)
    invalid.edit['2K'] = []
    expect(() => normalizeSubmittedGptRoutes(invalid)).toThrow(/至少保留/)
  })

  it('migrates old channel and route arrays and prefers valid v2 JSON', () => {
    const migrated = migrateStoredGptRoutes({
      storedRoutes: '',
      legacy2k: JSON.stringify(['catapi', 'sixoner']),
      legacy4k: JSON.stringify(['primary', 'sixoner']),
      legacyChannel: 'catapi',
    })
    expect(migrated.generate['2K']).toEqual(['catapi', 'sixoner'])
    expect(migrated.edit['4K']).toEqual(['primary', 'sixoner'])

    const v2 = migrateStoredGptRoutes({
      storedRoutes: JSON.stringify({ generate: { '2K': ['primary'], '4K': ['sixoner'] }, edit: { '2K': ['catapi'], '4K': ['primary'] } }),
      legacy2k: JSON.stringify(['catapi']),
      legacy4k: JSON.stringify(['catapi']),
      legacyChannel: 'catapi',
    })
    expect(v2).toEqual({
      generate: { '2K': ['primary'], '4K': ['sixoner'] },
      edit: { '2K': ['catapi'], '4K': ['primary'] },
    })
    expect(routesFromLegacyChannel('primary').generate['2K'][0]).toBe('primary')
  })

  it('maps legacy stream modes to the boolean setting', () => {
    expect(RECOMMENDED_STREAM_ENABLED).toBe(true)
    expect(RECOMMENDED_AUTO_FALLBACK_ON_MISMATCH).toBe(false)
    expect(streamEnabledFromLegacyMode('off')).toBe(false)
    expect(streamEnabledFromLegacyMode('CLIENT')).toBe(true)
    expect(normalizeStreamEnabled('0')).toBe(false)
    expect(normalizeStreamEnabled('yes')).toBe(true)
    expect(normalizeStreamMode('client')).toBe('client')
    expect(normalizeStreamMode('on')).toBe('client')
    expect(streamEnabledFromLegacyMode('force')).toBe(true)
    expect(streamModeFromEnabled(false)).toBe('off')
    expect(streamModeFromEnabled(true)).toBe('client')
  })
})
