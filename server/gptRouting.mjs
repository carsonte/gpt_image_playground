// GPT 生图后台路由和流式策略的纯函数，便于启动时和接口层复用。

export const GPT_CHANNELS = ['primary', 'sixoner', 'catapi']
export const GPT_ACTIONS = ['generate', 'edit']
export const GPT_TIERS = ['2K', '4K']
// 旧版本使用 off/client/force 三态；新设置只保留是否允许流式的布尔值。
export const STREAM_MODES = ['off', 'client', 'force']
export const RECOMMENDED_STREAM_ENABLED = true
export const RECOMMENDED_AUTO_FALLBACK_ON_MISMATCH = false

// 当前实测 Sixoner 更容易保持 high 和目标尺寸，因此作为四组默认首选。
export const RECOMMENDED_GPT_ROUTES = Object.freeze({
  generate: Object.freeze({
    '2K': Object.freeze(['sixoner', 'catapi', 'primary']),
    '4K': Object.freeze(['sixoner', 'catapi', 'primary']),
  }),
  edit: Object.freeze({
    '2K': Object.freeze(['sixoner', 'catapi', 'primary']),
    '4K': Object.freeze(['sixoner', 'catapi', 'primary']),
  }),
})

const channelSet = new Set(GPT_CHANNELS)
const actionSet = new Set(GPT_ACTIONS)
const tierSet = new Set(GPT_TIERS)
const streamModeSet = new Set(STREAM_MODES)

export function normalizeStreamEnabled(value, fallback = RECOMMENDED_STREAM_ENABLED) {
  if (typeof value === 'boolean') return value
  if (value === 1) return true
  if (value === 0) return false
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
  }
  return fallback
}

export function normalizeAutoFallbackOnMismatch(value, fallback = RECOMMENDED_AUTO_FALLBACK_ON_MISMATCH) {
  return normalizeStreamEnabled(value, fallback)
}

export function normalizeStreamMode(value, fallback = RECOMMENDED_STREAM_ENABLED ? 'client' : 'off') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value
  if (normalized === 'on' || normalized === true || normalized === 1) return 'client'
  return streamModeSet.has(normalized) ? normalized : fallback
}

export function streamEnabledFromLegacyMode(value, fallback = RECOMMENDED_STREAM_ENABLED) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value
  if (normalized === 'off') return false
  if (normalized === 'on' || normalized === 'client' || normalized === 'force') return true
  return normalizeStreamEnabled(value, fallback)
}

export function streamModeFromEnabled(value) {
  return value ? 'client' : 'off'
}

export function normalizeRouteList(value, fallback = RECOMMENDED_GPT_ROUTES.generate['2K']) {
  if (!Array.isArray(value)) return [...fallback]
  const routes = [...new Set(value.filter((item) => channelSet.has(item)))]
  return routes.length ? routes : [...fallback]
}

function normalizeActionRoutes(value, fallback) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    '2K': normalizeRouteList(input['2K'], fallback['2K']),
    '4K': normalizeRouteList(input['4K'], fallback['4K']),
  }
}

export function normalizeGptRoutes(value, fallback = RECOMMENDED_GPT_ROUTES) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  if ('2K' in input || '4K' in input) {
    const legacy = input
    const generate = normalizeActionRoutes(legacy, fallback.generate)
    return {
      generate,
      edit: {
        '2K': [...generate['2K']],
        '4K': [...generate['4K']],
      },
    }
  }
  return {
    generate: normalizeActionRoutes(input.generate, fallback.generate),
    edit: normalizeActionRoutes(input.edit, fallback.edit),
  }
}

export function cloneGptRoutes(routes) {
  return {
    generate: {
      '2K': [...routes.generate['2K']],
      '4K': [...routes.generate['4K']],
    },
    edit: {
      '2K': [...routes.edit['2K']],
      '4K': [...routes.edit['4K']],
    },
  }
}

export function normalizeSubmittedGptRoutes(value, fallback = RECOMMENDED_GPT_ROUTES) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('GPT 线路配置必须是对象')
  const result = {}
  for (const action of GPT_ACTIONS) {
    const actionValue = value[action]
    if (!actionValue || typeof actionValue !== 'object' || Array.isArray(actionValue)) throw new Error(`${action} 线路配置必须是对象`)
    result[action] = {}
    for (const tier of GPT_TIERS) {
      const list = actionValue[tier]
      if (!Array.isArray(list) || list.length < 1 || list.length > GPT_CHANNELS.length) {
        throw new Error(`${action} ${tier} 线路至少保留 1 条、最多 3 条`)
      }
      if (list.some((channel) => !channelSet.has(channel)) || new Set(list).size !== list.length) {
        throw new Error(`${action} ${tier} 线路包含无效或重复渠道`)
      }
      result[action][tier] = [...list]
    }
  }
  return result
}

// 兼容旧版只有一个 gptChannel 的配置；新配置没有时统一采用推荐顺序。
export function routesFromLegacyChannel(channel, fallback = RECOMMENDED_GPT_ROUTES) {
  const legacy = channelSet.has(channel) ? channel : ''
  if (!legacy) return cloneGptRoutes(fallback)
  const routes = cloneGptRoutes(fallback)
  for (const action of GPT_ACTIONS) {
    const fallbackOrder = fallback[action]['4K']
    const ordered = [
      legacy,
      ...fallbackOrder.filter((item) => item !== legacy),
      ...GPT_CHANNELS.filter((item) => item !== legacy && !fallbackOrder.includes(item)),
    ]
    routes[action]['2K'] = [...ordered]
    routes[action]['4K'] = [...ordered]
  }
  return routes
}

export function getRouteList(routes, action, tier) {
  const safeAction = actionSet.has(action) ? action : 'generate'
  const safeTier = tierSet.has(tier) ? tier : '4K'
  return routes[safeAction][safeTier]
}

// 旧版本分别保存了 2K/4K 数组；支持数组、旧的两档对象和新四组对象。
export function parseStoredRoutes(value, fallback = RECOMMENDED_GPT_ROUTES, action, tier) {
  if (!value) return cloneGptRoutes(fallback)
  try {
    const parsed = JSON.parse(value)
    if (action && tier && Array.isArray(parsed)) {
      const routes = cloneGptRoutes(fallback)
      routes[action][tier] = normalizeRouteList(parsed, fallback[action][tier])
      return routes
    }
    return normalizeGptRoutes(parsed, fallback)
  } catch {
    return cloneGptRoutes(fallback)
  }
}

export function migrateStoredGptRoutes({ storedRoutes, storedRoutesAlias, legacy2k, legacy4k, legacyChannel }, fallback = RECOMMENDED_GPT_ROUTES) {
  for (const candidate of [storedRoutes, storedRoutesAlias]) {
    if (!candidate) continue
    try {
      return normalizeGptRoutes(JSON.parse(candidate), fallback)
    } catch {
      // 无效的新配置继续尝试旧字段。
    }
  }
  const routes = routesFromLegacyChannel(legacyChannel, fallback)
  for (const action of GPT_ACTIONS) {
    if (legacy2k) {
      try {
        routes[action]['2K'] = normalizeRouteList(JSON.parse(legacy2k), routes[action]['2K'])
      } catch {
        // 使用推荐回退。
      }
    }
    if (legacy4k) {
      try {
        routes[action]['4K'] = normalizeRouteList(JSON.parse(legacy4k), routes[action]['4K'])
      } catch {
        // 使用推荐回退。
      }
    }
  }
  return routes
}
