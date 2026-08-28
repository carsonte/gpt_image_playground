import { createReadStream, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { finished, pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import express from 'express'
import { config } from './config.mjs'
import { db } from './database.mjs'
import {
  createSessionToken,
  hashIp,
  hashToken,
  normalizeIp,
  safeDetails,
  sanitizeError,
  verifyPassword,
} from './security.mjs'

const app = express()
const distDir = resolve('./dist')
const sessionCookie = 'gpt_image_admin'
const loginFailures = new Map()
const promptOptimizeRequests = new Map()
const proxyQueue = []
const activeProxyItems = new Map()
let activeProxyRequests = 0
const senseNovaQueue = []
const activeSenseNovaItems = new Map()
let activeSenseNovaRequests = 0
const defaultPrivacyNotice = '图片仅保存在当前浏览器，服务器不保存图片'
const gptChannels = new Set(['sixoner', 'catapi'])
const gptFallbackStatuses = new Set([401, 402, 403, 404, 405, 408, 409, 429])
const senseNovaSizes = new Set([
  '2752x1536', '1536x2752', '2048x2048', '2496x1664', '1664x2496', '2368x1760',
  '1760x2368', '2272x1824', '1824x2272', '3072x1376', '1344x3136',
])

function readAppSetting(key, fallback) {
  return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? fallback
}

function saveAppSetting(key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), now())
}

const savedConcurrency = Number.parseInt(readAppSetting('upstream_concurrency', ''), 10)
let upstreamConcurrency = Number.isFinite(savedConcurrency)
  ? Math.max(1, Math.min(20, savedConcurrency))
  : config.upstreamConcurrency
const savedPerIpConcurrency = Number.parseInt(readAppSetting('per_ip_concurrency', ''), 10)
let perIpConcurrency = Number.isFinite(savedPerIpConcurrency)
  ? Math.max(1, Math.min(20, savedPerIpConcurrency))
  : 2
const savedPerIpQueueLimit = Number.parseInt(readAppSetting('per_ip_queue_limit', ''), 10)
let perIpQueueLimit = Number.isFinite(savedPerIpQueueLimit)
  ? Math.max(0, Math.min(100, savedPerIpQueueLimit))
  : 3
const savedSenseNovaConcurrency = Number.parseInt(readAppSetting('sensenova_concurrency', ''), 10)
let senseNovaConcurrency = Number.isFinite(savedSenseNovaConcurrency)
  ? Math.max(1, Math.min(20, savedSenseNovaConcurrency))
  : config.senseNovaConcurrency
const savedSenseNovaPerIpConcurrency = Number.parseInt(readAppSetting('sensenova_per_ip_concurrency', ''), 10)
let senseNovaPerIpConcurrency = Number.isFinite(savedSenseNovaPerIpConcurrency)
  ? Math.max(1, Math.min(20, savedSenseNovaPerIpConcurrency))
  : 1
const savedSenseNovaPerIpQueueLimit = Number.parseInt(readAppSetting('sensenova_per_ip_queue_limit', ''), 10)
let senseNovaPerIpQueueLimit = Number.isFinite(savedSenseNovaPerIpQueueLimit)
  ? Math.max(0, Math.min(100, savedSenseNovaPerIpQueueLimit))
  : 2
let privacyNoticeEnabled = readAppSetting('privacy_notice_enabled', 'true') === 'true'
let privacyNoticeText = readAppSetting('privacy_notice_text', defaultPrivacyNotice)
let queueStatusEnabled = readAppSetting('queue_status_enabled', 'true') === 'true'
const savedGptChannel = readAppSetting('gpt_upstream_channel', 'sixoner')
let gptChannel = gptChannels.has(savedGptChannel) ? savedGptChannel : 'sixoner'

app.set('trust proxy', config.trustProxy)
app.disable('x-powered-by')

function now() {
  return new Date().toISOString()
}

function getIpHash(req) {
  return hashIp(getClientIp(req))
}

function getClientIp(req) {
  return normalizeIp(req.ip || req.socket.remoteAddress)
}

function getActiveBlock(ipAddress) {
  return db.prepare(`
    SELECT * FROM blocked_ips
    WHERE ip_address = ? AND (expires_at IS NULL OR expires_at > ?)
  `).get(ipAddress, now()) ?? null
}

function readPromptAudit(req) {
  try {
    return Buffer.from(String(req.headers['x-image-prompt-b64'] ?? ''), 'base64').toString('utf8').trim().slice(0, 5000)
  } catch {
    return ''
  }
}

function readParamsAudit(req) {
  try {
    const text = Buffer.from(String(req.headers['x-image-params-b64'] ?? ''), 'base64').toString('utf8')
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

function getResolutionTier(size) {
  const dimensions = String(size).match(/(\d+)\s*[x×]\s*(\d+)/i)
  if (!dimensions) return 'other'
  const edge = Math.max(Number(dimensions[1]), Number(dimensions[2]))
  if (edge <= 1536) return '1K'
  if (edge <= 2560) return '2K'
  if (edge <= 4096) return '4K'
  return 'other'
}

function getUpstreamModel(upstream, size) {
  if (upstream.channel === 'catapi' && getResolutionTier(size) === '2K') return config.catApi2kModel
  if (upstream.channel === 'catapi' && getResolutionTier(size) === '4K') return config.catApi4kModel
  if (upstream.channel === 'sixoner' && getResolutionTier(size) === '2K') return config.sixoner2kModel
  if (upstream.channel === 'sixoner' && getResolutionTier(size) === '4K') return config.sixoner4kModel
  return upstream.model
}

function replaceMultipartTextField(body, field, value) {
  const marker = Buffer.from(`name="${field}"`)
  const markerIndex = body.indexOf(marker)
  if (markerIndex < 0) return body
  const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), markerIndex + marker.length)
  if (headerEnd < 0) return body
  const valueStart = headerEnd + 4
  const valueEnd = body.indexOf(Buffer.from('\r\n'), valueStart)
  if (valueEnd < 0) return body
  return Buffer.concat([body.subarray(0, valueStart), Buffer.from(value), body.subarray(valueEnd)])
}

function runProxyQueue() {
  while (activeProxyRequests < upstreamConcurrency && proxyQueue.length) {
    const activeByIp = new Map()
    for (const item of activeProxyItems.values()) {
      activeByIp.set(item.ipAddress, (activeByIp.get(item.ipAddress) ?? 0) + 1)
    }
    const idx = proxyQueue.findIndex((item) => (activeByIp.get(item.metadata.ipAddress) ?? 0) < perIpConcurrency)
    if (idx < 0) return
    const [item] = proxyQueue.splice(idx, 1)
    if (item.req.aborted) {
      item.resolve(null)
      continue
    }
    activeProxyRequests += 1
    item.req.off('aborted', item.onAborted)
    const startedAt = Date.now()
    activeProxyItems.set(item.metadata.requestId, { ...item.metadata, queuedAt: item.queuedAt, startedAt })
    let released = false
    item.resolve({
      waitedMs: Date.now() - item.queuedAt,
      release: () => {
        if (released) return
        released = true
        activeProxyItems.delete(item.metadata.requestId)
        activeProxyRequests = Math.max(0, activeProxyRequests - 1)
        runProxyQueue()
      },
    })
  }
}

function acquireProxySlot(req, metadata) {
  return new Promise((resolveSlot) => {
    const item = {
      req,
      queuedAt: Date.now(),
      metadata,
      resolve: resolveSlot,
      onAborted: null,
    }
    item.onAborted = () => {
      const idx = proxyQueue.indexOf(item)
      if (idx < 0) return
      proxyQueue.splice(idx, 1)
      resolveSlot(null)
    }
    req.once('aborted', item.onAborted)
    proxyQueue.push(item)
    runProxyQueue()
  })
}

function runSenseNovaQueue() {
  while (activeSenseNovaRequests < senseNovaConcurrency && senseNovaQueue.length) {
    const activeByIp = new Map()
    for (const item of activeSenseNovaItems.values()) {
      activeByIp.set(item.ipAddress, (activeByIp.get(item.ipAddress) ?? 0) + 1)
    }
    const idx = senseNovaQueue.findIndex((item) => (activeByIp.get(item.metadata.ipAddress) ?? 0) < senseNovaPerIpConcurrency)
    if (idx < 0) return
    const [item] = senseNovaQueue.splice(idx, 1)
    if (item.req.aborted) {
      item.resolve(null)
      continue
    }
    activeSenseNovaRequests += 1
    item.req.off('aborted', item.onAborted)
    const startedAt = Date.now()
    activeSenseNovaItems.set(item.metadata.requestId, { ...item.metadata, queuedAt: item.queuedAt, startedAt })
    let released = false
    item.resolve({
      waitedMs: Date.now() - item.queuedAt,
      release: () => {
        if (released) return
        released = true
        activeSenseNovaItems.delete(item.metadata.requestId)
        activeSenseNovaRequests = Math.max(0, activeSenseNovaRequests - 1)
        runSenseNovaQueue()
      },
    })
  }
}

function acquireSenseNovaSlot(req, metadata) {
  return new Promise((resolveSlot) => {
    const item = {
      req,
      queuedAt: Date.now(),
      metadata,
      resolve: resolveSlot,
      onAborted: null,
    }
    item.onAborted = () => {
      const idx = senseNovaQueue.indexOf(item)
      if (idx < 0) return
      senseNovaQueue.splice(idx, 1)
      resolveSlot(null)
    }
    req.once('aborted', item.onAborted)
    senseNovaQueue.push(item)
    runSenseNovaQueue()
  })
}

const keywordStopWords = new Set([
  '一个', '一张', '一幅', '一只', '一种', '这个', '那个', '生成', '创建', '制作', '图片', '图像', '照片', '画面', '风格', '背景', '高清', '超清', '的', '了', '在', '和', '与', '及', '为', '是', '有',
  'the', 'and', 'with', 'from', 'into', 'for', 'this', 'that', 'image', 'photo', 'picture', 'create', 'generate',
])
const keywordSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

function getPromptKeywords(prompt) {
  const words = []
  const segments = [...keywordSegmenter.segment(String(prompt).toLowerCase())]
  for (let idx = 0; idx < segments.length; idx += 1) {
    const item = segments[idx]
    if (!item.isWordLike) continue
    const word = item.segment.trim()
    if (!word || keywordStopWords.has(word)) continue
    if (/^[a-z0-9_-]+$/i.test(word) && word.length < 2) continue
    if (/^\p{Script=Han}$/u.test(word)) {
      const next = segments[idx + 1]
      const nextWord = next?.isWordLike ? next.segment.trim() : ''
      if (/^\p{Script=Han}$/u.test(nextWord) && !keywordStopWords.has(nextWord)) words.push(`${word}${nextWord}`)
      continue
    }
    words.push(word.slice(0, 40))
  }
  return [...new Set(words)]
}

function addLog({ requestId = '', level = 'info', type, event, ipHash = '', status = '', durationMs = null, details = {} }) {
  db.prepare(`
    INSERT INTO logs (request_id, level, type, event, ip_hash, status, duration_ms, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(requestId, level, type, event, ipHash, status, durationMs, safeDetails(details), now())
}

function readCookies(req) {
  const cookies = {}
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim())
  }
  return cookies
}

function getSession(req) {
  const token = readCookies(req)[sessionCookie]
  if (!token) return null
  return db.prepare('SELECT * FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(hashToken(token), now()) ?? null
}

function requireAdmin(req, res, next) {
  if (!getSession(req)) return res.status(401).json({ error: '请先登录' })
  next()
}

function verifySameOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
  const origin = req.headers.origin
  if (!origin) return next()
  let originUrl
  try {
    originUrl = new URL(origin)
  } catch {
    return res.status(403).json({ error: '请求来源无效' })
  }
  const forwardedHost = String(req.headers['x-forwarded-host'] ?? '').split(',')[0].trim()
  const host = forwardedHost || req.headers.host
  const localDevelopment = ['127.0.0.1', 'localhost'].includes(originUrl.hostname) && ['127.0.0.1', 'localhost'].includes(req.hostname)
  if (originUrl.host !== host && !localDevelopment) return res.status(403).json({ error: '请求来源无效' })
  next()
}

function serializeAnnouncement(row) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    linkUrl: row.link_url,
    linkLabel: row.link_label,
    status: row.status,
    showPopup: Boolean(row.show_popup),
    popupOnce: Boolean(row.popup_once),
    pinned: Boolean(row.pinned),
    showBar: Boolean(row.show_bar),
    dismissible: Boolean(row.dismissible),
    priority: row.priority,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeAnnouncement(body) {
  const linkUrl = String(body.linkUrl ?? '').trim()
  if (linkUrl) {
    const invalidRelativeUrl = linkUrl.startsWith('//') || linkUrl.startsWith('/\\')
    let validHttpsUrl = false
    if (!linkUrl.startsWith('/')) {
      try {
        validHttpsUrl = new URL(linkUrl).protocol === 'https:'
      } catch {
        validHttpsUrl = false
      }
    }
    if (invalidRelativeUrl || (!linkUrl.startsWith('/') && !validHttpsUrl)) {
      throw new Error('公告链接仅支持 HTTPS 或站内相对地址')
    }
  }
  const status = ['draft', 'published', 'offline'].includes(body.status) ? body.status : 'draft'
  const showBar = Boolean(body.showBar || body.pinned)
  return {
    title: String(body.title ?? '').trim().slice(0, 120),
    content: String(body.content ?? '').trim().slice(0, 5000),
    linkUrl,
    linkLabel: String(body.linkLabel ?? '').trim().slice(0, 40),
    status,
    showPopup: Boolean(body.showPopup),
    popupOnce: body.popupOnce !== false,
    pinned: showBar,
    showBar,
    dismissible: body.dismissible !== false,
    priority: Math.max(-1000, Math.min(1000, Number.parseInt(body.priority ?? 0, 10) || 0)),
    startsAt: body.startsAt ? new Date(body.startsAt).toISOString() : null,
    endsAt: body.endsAt ? new Date(body.endsAt).toISOString() : null,
  }
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolveBody(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

app.post('/api-proxy/*path', async (req, res, next) => {
  if (req.headers['x-image-module'] !== 'sensenova-u1') return next()

  const requestId = randomUUID()
  const startedAt = Date.now()
  const ipAddress = getClientIp(req)
  const ipHash = hashIp(ipAddress)
  const endpoint = `/${Array.isArray(req.params.path) ? req.params.path.join('/') : req.params.path}`
  if (getActiveBlock(ipAddress)) {
    addLog({ requestId, level: 'warn', type: 'security', event: 'ip.blocked_request', ipHash, status: 'rejected', details: { endpoint, module: 'sensenova-u1' } })
    return res.status(403).json({ error: '当前 IP 已被禁止使用生图服务', requestId })
  }
  if (endpoint !== '/images/generations') {
    return res.status(404).json({ error: 'U1 信息图当前仅支持文字生成', requestId })
  }
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    return res.status(415).json({ error: 'U1 信息图请求格式不受支持', requestId })
  }
  if (!config.senseNovaApiKey) {
    return res.status(503).json({ error: '服务器尚未配置 SenseNova API Key', requestId })
  }

  let payload
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'))
  } catch (error) {
    return res.status(400).json({ error: sanitizeError(error.message), requestId })
  }
  const prompt = String(payload.prompt ?? readPromptAudit(req)).trim().slice(0, 5000)
  const size = String(payload.size ?? '2048x2048')
  if (!prompt) return res.status(400).json({ error: '请输入信息图描述', requestId })
  if (!senseNovaSizes.has(size)) return res.status(400).json({ error: '当前尺寸不受 U1 信息图支持', requestId })
  if (Number.parseInt(payload.n ?? 1, 10) !== 1) {
    return res.status(400).json({ error: 'U1 信息图每次只能生成 1 张图片', requestId })
  }

  const activeForIp = [...activeSenseNovaItems.values()].filter((item) => item.ipAddress === ipAddress).length
  const waitingForIp = senseNovaQueue.filter((item) => item.metadata.ipAddress === ipAddress).length
  if (activeForIp + waitingForIp >= senseNovaPerIpConcurrency + senseNovaPerIpQueueLimit) {
    res.setHeader('Retry-After', '10')
    addLog({ requestId, level: 'warn', type: 'security', event: 'ip.queue_limited', ipHash, status: 'rejected', details: { endpoint, module: 'sensenova-u1' } })
    return res.status(429).json({ error: `当前 IP 的 U1 任务过多，最多同时生成 ${senseNovaPerIpConcurrency} 个、排队 ${senseNovaPerIpQueueLimit} 个，请稍后再试`, requestId })
  }
  const willQueue = activeSenseNovaRequests >= senseNovaConcurrency || activeForIp >= senseNovaPerIpConcurrency
  if (willQueue) {
    addLog({ requestId, type: 'request', event: 'image.queued', ipHash, status: 'queued', details: { endpoint, module: 'sensenova-u1', position: senseNovaQueue.length + 1 } })
  }
  const slot = await acquireSenseNovaSlot(req, { requestId, ipAddress, endpoint, action: 'generate', prompt, size, imageCount: 1 })
  if (!slot) return

  db.prepare(`
    INSERT INTO generation_events (
      request_id, ip_hash, ip_address, endpoint, module, action, model, prompt, size,
      resolution_tier, quality, image_count, status, created_at
    ) VALUES (?, ?, ?, ?, 'sensenova-u1', 'generate', ?, ?, ?, ?, '', 1, 'started', ?)
  `).run(requestId, ipHash, ipAddress, endpoint, config.senseNovaModel, prompt, size, getResolutionTier(size), now())

  try {
    const response = await fetch(`${config.senseNovaApiUrl}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.senseNovaApiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: config.senseNovaModel, prompt, size, n: 1, watermark: false }),
      signal: AbortSignal.timeout(600_000),
    })
    let body = Buffer.from(await response.arrayBuffer())
    if (response.ok && String(response.headers.get('content-type') ?? '').includes('application/json')) {
      try {
        const payload = JSON.parse(body.toString('utf8'))
        if (Array.isArray(payload.data)) {
          for (const item of payload.data) {
            if (typeof item?.url !== 'string' || item.b64_json) continue
            const imageUrl = new URL(item.url)
            if (imageUrl.protocol !== 'https:') continue
            const imageResponse = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000) })
            const contentLength = Number.parseInt(imageResponse.headers.get('content-length') ?? '0', 10)
            if (!imageResponse.ok || contentLength > 25 * 1024 * 1024) continue
            const image = Buffer.from(await imageResponse.arrayBuffer())
            if (image.length > 25 * 1024 * 1024) continue
            item.b64_json = image.toString('base64')
            delete item.url
          }
          body = Buffer.from(JSON.stringify(payload))
        }
      } catch (error) {
        addLog({ requestId, level: 'warn', type: 'system', event: 'sensenova.image_normalize_failed', ipHash, status: 'fallback', details: { message: sanitizeError(error.message) } })
      }
    }
    res.status(response.status)
    res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json')
    res.setHeader('X-Request-Id', requestId)
    const delivered = finished(res)
    res.end(body)
    await delivered
    const durationMs = Date.now() - startedAt
    const status = response.ok ? 'success' : 'failed'
    db.prepare(`
      UPDATE generation_events
      SET status = ?, upstream_status = ?, duration_ms = ?, error_summary = ?, completed_at = ?
      WHERE request_id = ?
    `).run(status, response.status, durationMs, response.ok ? '' : sanitizeError(body.toString('utf8')), now(), requestId)
    addLog({
      requestId,
      level: response.ok ? 'info' : 'warn',
      type: 'request',
      event: 'image.proxy',
      ipHash,
      status,
      durationMs,
      details: { endpoint, module: 'sensenova-u1', model: config.senseNovaModel, imageCount: 1, upstreamStatus: response.status, queueWaitMs: slot.waitedMs },
    })
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const message = sanitizeError(error.message)
    db.prepare(`
      UPDATE generation_events
      SET status = 'failed', duration_ms = ?, error_summary = ?, completed_at = ?
      WHERE request_id = ?
    `).run(durationMs, message, now(), requestId)
    addLog({ requestId, level: 'error', type: 'system', event: 'image.proxy_error', ipHash, status: 'failed', durationMs, details: { endpoint, module: 'sensenova-u1', model: config.senseNovaModel, message } })
    if (!res.headersSent) res.status(502).json({ error: 'SenseNova 图片服务请求失败', requestId })
    else if (!res.destroyed && !res.writableEnded) res.end()
  } finally {
    slot.release()
  }
})

app.post('/api-proxy/*path', async (req, res) => {
  const requestId = randomUUID()
  const startedAt = Date.now()
  const ipAddress = getClientIp(req)
  const ipHash = hashIp(ipAddress)
  const endpoint = `/${Array.isArray(req.params.path) ? req.params.path.join('/') : req.params.path}`
  if (getActiveBlock(ipAddress)) {
    addLog({ requestId, level: 'warn', type: 'security', event: 'ip.blocked_request', ipHash, status: 'rejected', details: { endpoint } })
    return res.status(403).json({ error: '当前 IP 已被禁止使用生图服务', requestId })
  }
  const allowedPaths = new Set(['/images/generations', '/images/edits', '/responses'])
  if (!allowedPaths.has(endpoint)) {
    addLog({ requestId, level: 'warn', type: 'security', event: 'proxy.path_rejected', ipHash, status: 'rejected', details: { endpoint } })
    return res.status(404).json({ error: '不支持的代理路径', requestId })
  }
  const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
  if (endpoint === '/images/edits' ? !contentType.startsWith('multipart/form-data') : !contentType.startsWith('application/json')) {
    addLog({ requestId, level: 'warn', type: 'security', event: 'proxy.content_type_rejected', ipHash, status: 'rejected', details: { endpoint } })
    return res.status(415).json({ error: '请求格式不受支持', requestId })
  }
  const primaryUpstream = { channel: 'primary', apiUrl: config.upstreamApiUrl, apiKey: config.upstreamApiKey, model: config.upstreamModel }
  const sixonerUpstream = { channel: 'sixoner', apiUrl: config.sixonerApiUrl, apiKey: config.sixonerApiKey, model: config.sixonerModel }
  const catApiUpstream = { channel: 'catapi', apiUrl: config.catApiUrl, apiKey: config.catApiKey, model: config.catApiModel }
  const auditParams = readParamsAudit(req)
  const auditedImageCount = Math.max(1, Number.parseInt(auditParams.n ?? 1, 10) || 1)
  if (auditedImageCount > 1) {
    return res.status(400).json({ error: '当前服务每次只能生成 1 张图片', requestId })
  }
  const imageCount = 1
  let prompt = readPromptAudit(req)
  let size = typeof auditParams.size === 'string' ? auditParams.size.slice(0, 40) : ''
  let quality = typeof auditParams.quality === 'string' ? auditParams.quality.slice(0, 40) : ''
  const defaultRouteChannel = gptChannel === 'catapi' && !config.catApiKey ? 'sixoner' : gptChannel
  const getGptUpstreamChain = (channel) => (channel === 'catapi'
    ? [catApiUpstream, sixonerUpstream, primaryUpstream]
    : [sixonerUpstream, primaryUpstream]
  ).filter((upstream, idx) => idx === 0 || upstream.apiKey)
  let routeChannel = getResolutionTier(size) === '2K' && config.catApiKey ? 'catapi' : defaultRouteChannel
  let upstreamChain = getGptUpstreamChain(routeChannel)
  let gptUpstream = upstreamChain[0]
  if (!gptUpstream.apiKey) return res.status(503).json({ error: `服务器尚未配置 ${gptUpstream.channel === 'catapi' ? 'CatAPI' : 'Sixoner'} API Key`, requestId })
  const requestedAction = String(req.headers['x-image-action'] ?? '')
  const action = ['generate', 'edit'].includes(requestedAction) ? requestedAction : endpoint === '/images/edits' ? 'edit' : 'generate'
  const activeForIp = [...activeProxyItems.values()].filter((item) => item.ipAddress === ipAddress).length
  const waitingForIp = proxyQueue.filter((item) => item.metadata.ipAddress === ipAddress).length
  if (activeForIp + waitingForIp >= perIpConcurrency + perIpQueueLimit) {
    res.setHeader('Retry-After', '10')
    addLog({ requestId, level: 'warn', type: 'security', event: 'ip.queue_limited', ipHash, status: 'rejected', details: { endpoint } })
    return res.status(429).json({ error: `当前 IP 的任务过多，最多同时生成 ${perIpConcurrency} 个、排队 ${perIpQueueLimit} 个，请稍后再试`, requestId })
  }
  const willQueue = activeProxyRequests >= upstreamConcurrency || activeForIp >= perIpConcurrency
  if (willQueue) {
    addLog({ requestId, type: 'request', event: 'image.queued', ipHash, status: 'queued', details: { endpoint, position: proxyQueue.length + 1 } })
  }
  const slot = await acquireProxySlot(req, { requestId, ipAddress, endpoint, action, prompt, size, imageCount })
  if (!slot) return

  try {
    let model = gptUpstream.model
    let body
    let payload = null
    try {
      if (String(req.headers['content-type'] ?? '').includes('application/json')) {
        body = await readBody(req)
        payload = JSON.parse(body.toString('utf8'))
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('请求内容必须是 JSON 对象')
        if (endpoint === '/images/generations') {
          payload.output_format = 'png'
          delete payload.output_compression
        }
        if (!prompt && typeof payload.prompt === 'string') prompt = payload.prompt.trim().slice(0, 5000)
        if (typeof payload.size === 'string') size = payload.size.slice(0, 40)
        if (typeof payload.quality === 'string') quality = payload.quality.slice(0, 40)
        const requestedImageCount = Math.max(1, Number.parseInt(payload.n ?? auditParams.n ?? 1, 10) || 1)
        if (requestedImageCount > 1) return res.status(400).json({ error: '当前服务每次只能生成 1 张图片', requestId })
        if (endpoint.startsWith('/images/')) payload.n = 1
      } else {
        body = await readBody(req, 60 * 1024 * 1024)
      }
      const requestedRouteChannel = getResolutionTier(size) === '2K' && config.catApiKey ? 'catapi' : defaultRouteChannel
      if (requestedRouteChannel !== routeChannel) {
        routeChannel = requestedRouteChannel
        upstreamChain = getGptUpstreamChain(routeChannel)
        gptUpstream = upstreamChain[0]
      }
      model = getUpstreamModel(gptUpstream, size)
    } catch (error) {
      return res.status(400).json({ error: sanitizeError(error.message), requestId })
    }

    db.prepare(`
      INSERT INTO generation_events (
        request_id, ip_hash, ip_address, endpoint, module, action, model, prompt, size,
        resolution_tier, quality, image_count, status, created_at
      ) VALUES (?, ?, ?, ?, 'gpt', ?, ?, ?, ?, ?, ?, ?, 'started', ?)
    `).run(requestId, ipHash, ipAddress, endpoint, action, model, prompt, size, getResolutionTier(size), quality, imageCount, now())

    try {
      const sendUpstream = (upstream) => {
        const upstreamModel = getUpstreamModel(upstream, size)
        const upstreamBody = payload
          ? Buffer.from(JSON.stringify({ ...payload, model: upstreamModel }))
          : replaceMultipartTextField(replaceMultipartTextField(body, 'output_format', 'png'), 'model', upstreamModel)
        const headers = {
          Authorization: `Bearer ${upstream.apiKey}`,
          Accept: req.headers.accept || 'application/json',
        }
        if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type']
        return fetch(`${upstream.apiUrl}${endpoint}`, {
          method: 'POST',
          headers,
          body: upstreamBody,
          duplex: 'half',
          signal: AbortSignal.timeout(600_000),
        })
      }
      let upstreamIndex = 0
      let fallbackStatus = null
      let response
      while (true) {
        try {
          response = await sendUpstream(gptUpstream)
        } catch (error) {
          const nextUpstream = upstreamChain[upstreamIndex + 1]
          if (!nextUpstream) throw error
          addLog({ requestId, level: 'warn', type: 'request', event: 'image.proxy_fallback', ipHash, status: 'fallback', details: { endpoint, model, from: gptUpstream.channel, to: nextUpstream.channel, message: sanitizeError(error.message) } })
          upstreamIndex += 1
          gptUpstream = nextUpstream
          model = getUpstreamModel(gptUpstream, size)
          continue
        }

        const nextUpstream = upstreamChain[upstreamIndex + 1]
        if (!nextUpstream || (!gptFallbackStatuses.has(response.status) && response.status < 500)) break
        fallbackStatus = response.status
        await response.body?.cancel()
        addLog({ requestId, level: 'warn', type: 'request', event: 'image.proxy_fallback', ipHash, status: 'fallback', details: { endpoint, model, from: gptUpstream.channel, to: nextUpstream.channel, upstreamStatus: fallbackStatus } })
        upstreamIndex += 1
        gptUpstream = nextUpstream
        model = getUpstreamModel(gptUpstream, size)
      }
      res.status(response.status)
      for (const name of ['content-type', 'cache-control']) {
        const value = response.headers.get(name)
        if (value) res.setHeader(name, value)
      }
      res.setHeader('X-Request-Id', requestId)
      res.setHeader('X-Image-Upstream', gptUpstream.channel)
      res.setHeader('X-Image-Model', model)
      if (response.body) {
        await pipeline(Readable.fromWeb(response.body), res)
      } else {
        const delivered = finished(res)
        res.end()
        await delivered
      }
      const durationMs = Date.now() - startedAt
      const status = response.ok ? 'success' : 'failed'
      db.prepare(`
        UPDATE generation_events
        SET model = ?, status = ?, upstream_status = ?, duration_ms = ?, completed_at = ?
        WHERE request_id = ?
      `).run(model, status, response.status, durationMs, now(), requestId)
      addLog({
        requestId,
        level: response.ok ? 'info' : 'warn',
        type: 'request',
        event: 'image.proxy',
        ipHash,
        status,
        durationMs,
        details: { endpoint, model, imageCount, channel: gptUpstream.channel, upstreamStatus: response.status, fallbackStatus, queueWaitMs: slot.waitedMs },
      })
    } catch (error) {
      const durationMs = Date.now() - startedAt
      const message = sanitizeError(error.message)
      db.prepare(`
        UPDATE generation_events
        SET status = 'failed', duration_ms = ?, error_summary = ?, completed_at = ?
        WHERE request_id = ?
      `).run(durationMs, message, now(), requestId)
      addLog({ requestId, level: 'error', type: 'system', event: 'image.proxy_error', ipHash, status: 'failed', durationMs, details: { endpoint, model, imageCount, channel: gptUpstream.channel, message } })
      if (!res.headersSent) res.status(502).json({ error: '上游图片服务请求失败', requestId })
      else if (!res.destroyed && !res.writableEnded) res.end()
    }
  } finally {
    slot.release()
  }
})

app.use(express.json({ limit: '1mb' }))

app.post('/api/prompt/optimize', async (req, res) => {
  const startedAt = Date.now()
  const requestId = randomUUID()
  const ipAddress = getClientIp(req)
  const ipHash = hashIp(ipAddress)
  const prompt = typeof req.body.prompt === 'string' ? req.body.prompt.trim() : ''
  const module = req.body.module === 'sensenova-u1' ? 'sensenova-u1' : ''
  const size = senseNovaSizes.has(req.body.size) ? req.body.size : '2048x2048'

  if (getActiveBlock(ipAddress)) return res.status(403).json({ error: '当前 IP 已被限制访问' })
  if (module !== 'sensenova-u1') return res.status(400).json({ error: '提示词优化目前仅支持 U1 信息图' })
  if (!config.dotsApiKey) return res.status(503).json({ error: '服务器尚未配置提示词优化服务' })
  if (!prompt) return res.status(400).json({ error: '请先输入需要优化的提示词' })
  if (prompt.length > 8000) return res.status(400).json({ error: '提示词不能超过 8000 个字符' })

  const recent = (promptOptimizeRequests.get(ipHash) ?? []).filter((time) => time > Date.now() - 60_000)
  if (recent.length >= 10) {
    res.setHeader('Retry-After', '60')
    return res.status(429).json({ error: '提示词优化过于频繁，请稍后再试' })
  }
  promptOptimizeRequests.set(ipHash, [...recent, Date.now()])

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  try {
    const optimizationMode = prompt.length >= 500
      ? '用户输入已经比较详细，只整理信息层级和视觉表达，不继续扩写内容。'
      : '用户输入较简略，可以补充必要的版式、视觉层级和风格描述。'
    const response = await fetch(`${config.dotsApiUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': config.dotsApiKey,
      },
      body: JSON.stringify({
        model: config.dotsModel,
        messages: [
          {
            role: 'system',
            content: `你是专业的信息图生成提示词优化器。把用户输入整理成可直接用于 U1 信息图模型的提示词，并适配指定画布尺寸。${optimizationMode}

必须遵守以下规则：
1. 用户提供的数字、日期、时间、百分比、价格、单位、排名、产品名、专有名词、网址和 @图片引用均为只读数据，必须原样保留，不得修改、遗漏或虚构。
2. 引号中的标题、正文、口号和其他指定文案必须逐字保留，不得翻译或改写。
3. 不新增用户未提供的事实、数据、结论或宣传承诺；数据存在矛盾时也不得自行修正。
4. 保持用户原本的语言；中英混合内容保留原样。
5. 只优化信息层级、版式区域、标题与正文关系、配色、图标风格、留白和文字可读性。
6. 输出前自行核对所有只读数据与原文一致。
7. 只输出一份完整提示词，不要解释，不要使用 Markdown 标题或代码块。`,
          },
          { role: 'user', content: `画布尺寸：${size}\n\n用户原始提示词：\n${prompt}` },
        ],
        stream: false,
        max_tokens: 1200,
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      const upstreamMessage = typeof payload.error?.message === 'string' ? sanitizeError(payload.error.message) : ''
      throw new Error(upstreamMessage || `Dots API 返回 ${response.status}`)
    }
    const optimizedPrompt = typeof payload.choices?.[0]?.message?.content === 'string'
      ? payload.choices[0].message.content.trim().replace(/^```(?:text)?\s*/, '').replace(/\s*```$/, '')
      : ''
    if (!optimizedPrompt) throw new Error('Dots API 未返回优化结果')
    if (optimizedPrompt.length > 12_000) throw new Error('优化结果过长，请缩短原提示词后重试')
    const protectedTokens = [
      ...(prompt.match(/https?:\/\/[^\s]+/gi) ?? []),
      ...(prompt.match(/\d+(?:[.,]\d+)*(?:\s*(?:%|％|元|万元|万|亿|kg|g|mg|ml|L|°C|℃|年|月|日|时|分|秒))?/gi) ?? []),
      ...Array.from(prompt.matchAll(/[“"]([^”"]+)[”"]/g), (match) => match[1]),
      ...Array.from(prompt.matchAll(/[‘']([^’']+)[’']/g), (match) => match[1]),
    ]
    if (protectedTokens.some((token) => !optimizedPrompt.includes(token))) {
      throw new Error('优化结果未完整保留原始数据或指定文案，请调整原提示词后重试')
    }

    addLog({ requestId, type: 'request', event: 'prompt.optimize', ipHash, status: 'success', durationMs: Date.now() - startedAt, details: { module, inputLength: prompt.length, outputLength: optimizedPrompt.length } })
    res.setHeader('Cache-Control', 'no-store')
    res.json({ prompt: optimizedPrompt, model: config.dotsModel })
  } catch (error) {
    const message = error.name === 'AbortError' ? '提示词优化请求超时' : sanitizeError(error.message)
    addLog({ requestId, level: 'error', type: 'system', event: 'prompt.optimize_error', ipHash, status: 'failed', durationMs: Date.now() - startedAt, details: { module, message } })
    res.status(502).json({ error: message || '提示词优化失败' })
  } finally {
    clearTimeout(timeout)
  }
})

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    upstreamConfigured: Boolean(gptChannel === 'catapi' ? config.catApiKey : config.sixonerApiKey),
    gptChannel,
    primaryConfigured: Boolean(config.upstreamApiKey),
    sixonerConfigured: Boolean(config.sixonerApiKey),
    catApiConfigured: Boolean(config.catApiKey),
    senseNovaConfigured: Boolean(config.senseNovaApiKey),
    promptOptimizerConfigured: Boolean(config.dotsApiKey),
  })
})

app.get('/api/queue/status', (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  if (req.query.module === 'sensenova-u1') {
    return res.json({
      active: activeSenseNovaRequests,
      waiting: senseNovaQueue.length,
      concurrency: senseNovaConcurrency,
    })
  }
  res.json({
    active: activeProxyRequests,
    waiting: proxyQueue.length,
    concurrency: upstreamConcurrency,
  })
})

app.get('/api/site-config', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.json({ privacyNoticeEnabled, privacyNoticeText, queueStatusEnabled })
})

app.get('/api/announcements', (_req, res) => {
  const current = now()
  const rows = db.prepare(`
    SELECT * FROM announcements
    WHERE status = 'published'
      AND (starts_at IS NULL OR starts_at <= ?)
      AND (ends_at IS NULL OR ends_at >= ?)
      AND (show_popup = 1 OR pinned = 1 OR show_bar = 1)
    ORDER BY pinned DESC, priority DESC, created_at DESC
  `).all(current, current)
  res.json({ announcements: rows.map(serializeAnnouncement) })
})

app.post('/api/visits', (req, res) => {
  const ipAddress = getClientIp(req)
  const ipHash = hashIp(ipAddress)
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const existing = db.prepare('SELECT id FROM visit_sessions WHERE ip_hash = ? AND last_seen_at >= ? ORDER BY last_seen_at DESC LIMIT 1').get(ipHash, cutoff)
  if (existing) {
    db.prepare('UPDATE visit_sessions SET ip_address = ?, last_seen_at = ? WHERE id = ?').run(ipAddress, now(), existing.id)
  } else {
    const timestamp = now()
    db.prepare('INSERT INTO visit_sessions (ip_hash, ip_address, session_started_at, last_seen_at) VALUES (?, ?, ?, ?)').run(ipHash, ipAddress, timestamp, timestamp)
  }
  res.status(204).end()
})

app.post('/api/admin/login', (req, res) => {
  const ipHash = getIpHash(req)
  const failures = loginFailures.get(ipHash) ?? []
  const recent = failures.filter((time) => time > Date.now() - 15 * 60 * 1000)
  if (recent.length >= 10) {
    addLog({ level: 'warn', type: 'security', event: 'admin.login_rate_limited', ipHash, status: 'rejected' })
    return res.status(429).json({ error: '登录失败次数过多，请稍后重试' })
  }
  const username = String(req.body.username ?? '')
  const password = String(req.body.password ?? '')
  if (username !== config.adminUsername || !verifyPassword(password)) {
    loginFailures.set(ipHash, [...recent, Date.now()])
    addLog({ level: 'warn', type: 'security', event: 'admin.login_failed', ipHash, status: 'failed' })
    return res.status(401).json({ error: '用户名或密码错误' })
  }
  loginFailures.delete(ipHash)
  const token = createSessionToken()
  const createdAt = now()
  const expiresAt = new Date(Date.now() + config.sessionDays * 86400_000).toISOString()
  db.prepare('INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(hashToken(token), createdAt, expiresAt)
  res.cookie(sessionCookie, token, {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'strict',
    maxAge: config.sessionDays * 86400_000,
    path: '/',
  })
  addLog({ type: 'admin', event: 'admin.login', ipHash, status: 'success' })
  res.json({ username: config.adminUsername })
})

app.use('/api/admin', requireAdmin, verifySameOrigin)

app.get('/api/admin/session', (_req, res) => {
  res.json({ username: config.adminUsername })
})

app.post('/api/admin/logout', (req, res) => {
  const token = readCookies(req)[sessionCookie]
  if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token))
  res.clearCookie(sessionCookie, { path: '/' })
  addLog({ type: 'admin', event: 'admin.logout', ipHash: getIpHash(req), status: 'success' })
  res.status(204).end()
})

app.get('/api/admin/settings/queue', (_req, res) => {
  res.json({
    concurrency: upstreamConcurrency,
    perIpConcurrency,
    perIpQueueLimit,
    active: activeProxyRequests,
    waiting: proxyQueue.length,
    senseNovaConcurrency,
    senseNovaPerIpConcurrency,
    senseNovaPerIpQueueLimit,
    senseNovaActive: activeSenseNovaRequests,
    senseNovaWaiting: senseNovaQueue.length,
    senseNovaConfigured: Boolean(config.senseNovaApiKey),
    gptChannel,
    primaryConfigured: Boolean(config.upstreamApiKey),
    sixonerConfigured: Boolean(config.sixonerApiKey),
    catApiConfigured: Boolean(config.catApiKey),
  })
})

app.get('/api/admin/queue/tasks', (_req, res) => {
  const current = Date.now()
  res.setHeader('Cache-Control', 'no-store')
  res.json({
    concurrency: upstreamConcurrency,
    perIpConcurrency,
    perIpQueueLimit,
    active: [
      ...[...activeProxyItems.values()].map((item) => ({ ...item, module: 'gpt' })),
      ...[...activeSenseNovaItems.values()].map((item) => ({ ...item, module: 'sensenova-u1' })),
    ].map((item) => ({
      requestId: item.requestId,
      module: item.module,
      ipAddress: item.ipAddress,
      action: item.action,
      endpoint: item.endpoint,
      prompt: item.prompt,
      size: item.size,
      imageCount: item.imageCount,
      queuedAt: new Date(item.queuedAt).toISOString(),
      startedAt: new Date(item.startedAt).toISOString(),
      waitMs: item.startedAt - item.queuedAt,
      runtimeMs: current - item.startedAt,
    })),
    waiting: [
      ...proxyQueue.map((item, idx) => ({ ...item, module: 'gpt', position: idx + 1 })),
      ...senseNovaQueue.map((item, idx) => ({ ...item, module: 'sensenova-u1', position: idx + 1 })),
    ].map((item) => ({
      requestId: item.metadata.requestId,
      module: item.module,
      ipAddress: item.metadata.ipAddress,
      action: item.metadata.action,
      endpoint: item.metadata.endpoint,
      prompt: item.metadata.prompt,
      size: item.metadata.size,
      imageCount: item.metadata.imageCount,
      queuedAt: new Date(item.queuedAt).toISOString(),
      position: item.position,
      waitMs: current - item.queuedAt,
    })),
  })
})

app.put('/api/admin/settings/queue', (req, res) => {
  const concurrency = Number.parseInt(req.body.concurrency, 10)
  const nextPerIpConcurrency = Number.parseInt(req.body.perIpConcurrency, 10)
  const nextPerIpQueueLimit = Number.parseInt(req.body.perIpQueueLimit, 10)
  const nextSenseNovaConcurrency = Number.parseInt(req.body.senseNovaConcurrency ?? senseNovaConcurrency, 10)
  const nextSenseNovaPerIpConcurrency = Number.parseInt(req.body.senseNovaPerIpConcurrency ?? senseNovaPerIpConcurrency, 10)
  const nextSenseNovaPerIpQueueLimit = Number.parseInt(req.body.senseNovaPerIpQueueLimit ?? senseNovaPerIpQueueLimit, 10)
  const nextGptChannel = String(req.body.gptChannel ?? gptChannel)
  if (!Number.isFinite(concurrency) || concurrency < 1 || concurrency > 20) {
    return res.status(400).json({ error: '并发数量必须是 1–20 的整数' })
  }
  if (!Number.isFinite(nextPerIpConcurrency) || nextPerIpConcurrency < 1 || nextPerIpConcurrency > 20) {
    return res.status(400).json({ error: '单 IP 并发必须是 1–20 的整数' })
  }
  if (!Number.isFinite(nextPerIpQueueLimit) || nextPerIpQueueLimit < 0 || nextPerIpQueueLimit > 100) {
    return res.status(400).json({ error: '单 IP 排队上限必须是 0–100 的整数' })
  }
  if (!Number.isFinite(nextSenseNovaConcurrency) || nextSenseNovaConcurrency < 1 || nextSenseNovaConcurrency > 20) {
    return res.status(400).json({ error: 'U1 并发数量必须是 1–20 的整数' })
  }
  if (!Number.isFinite(nextSenseNovaPerIpConcurrency) || nextSenseNovaPerIpConcurrency < 1 || nextSenseNovaPerIpConcurrency > 20) {
    return res.status(400).json({ error: 'U1 单 IP 并发必须是 1–20 的整数' })
  }
  if (!Number.isFinite(nextSenseNovaPerIpQueueLimit) || nextSenseNovaPerIpQueueLimit < 0 || nextSenseNovaPerIpQueueLimit > 100) {
    return res.status(400).json({ error: 'U1 单 IP 排队上限必须是 0–100 的整数' })
  }
  if (!gptChannels.has(nextGptChannel)) {
    return res.status(400).json({ error: 'GPT 生图渠道无效' })
  }
  if (nextGptChannel === 'sixoner' && !config.sixonerApiKey) {
    return res.status(400).json({ error: '服务器尚未配置 Sixoner API Key' })
  }
  if (nextGptChannel === 'catapi' && !config.catApiKey) {
    return res.status(400).json({ error: '服务器尚未配置 CatAPI API Key' })
  }
  upstreamConcurrency = concurrency
  perIpConcurrency = nextPerIpConcurrency
  perIpQueueLimit = nextPerIpQueueLimit
  senseNovaConcurrency = nextSenseNovaConcurrency
  senseNovaPerIpConcurrency = nextSenseNovaPerIpConcurrency
  senseNovaPerIpQueueLimit = nextSenseNovaPerIpQueueLimit
  gptChannel = nextGptChannel
  const saveQueueSettings = db.transaction(() => {
    saveAppSetting('upstream_concurrency', concurrency)
    saveAppSetting('per_ip_concurrency', perIpConcurrency)
    saveAppSetting('per_ip_queue_limit', perIpQueueLimit)
    saveAppSetting('sensenova_concurrency', senseNovaConcurrency)
    saveAppSetting('sensenova_per_ip_concurrency', senseNovaPerIpConcurrency)
    saveAppSetting('sensenova_per_ip_queue_limit', senseNovaPerIpQueueLimit)
    saveAppSetting('gpt_upstream_channel', gptChannel)
  })
  saveQueueSettings()
  runProxyQueue()
  runSenseNovaQueue()
  addLog({ type: 'admin', event: 'settings.queue_update', ipHash: getIpHash(req), status: 'success', details: { concurrency, perIpConcurrency, perIpQueueLimit, senseNovaConcurrency, senseNovaPerIpConcurrency, senseNovaPerIpQueueLimit, gptChannel } })
  res.json({
    concurrency: upstreamConcurrency,
    perIpConcurrency,
    perIpQueueLimit,
    active: activeProxyRequests,
    waiting: proxyQueue.length,
    senseNovaConcurrency,
    senseNovaPerIpConcurrency,
    senseNovaPerIpQueueLimit,
    senseNovaActive: activeSenseNovaRequests,
    senseNovaWaiting: senseNovaQueue.length,
    senseNovaConfigured: Boolean(config.senseNovaApiKey),
    gptChannel,
    primaryConfigured: Boolean(config.upstreamApiKey),
    sixonerConfigured: Boolean(config.sixonerApiKey),
    catApiConfigured: Boolean(config.catApiKey),
  })
})

app.get('/api/admin/settings/site', (_req, res) => {
  res.json({ privacyNoticeEnabled, privacyNoticeText, queueStatusEnabled })
})

app.put('/api/admin/settings/site', (req, res) => {
  const nextPrivacyNoticeText = String(req.body.privacyNoticeText ?? '').trim().slice(0, 200)
  const nextPrivacyNoticeEnabled = Boolean(req.body.privacyNoticeEnabled)
  const nextQueueStatusEnabled = Boolean(req.body.queueStatusEnabled)
  if (nextPrivacyNoticeEnabled && !nextPrivacyNoticeText) {
    return res.status(400).json({ error: '开启本地存储提示时，请填写提示文字' })
  }
  privacyNoticeEnabled = nextPrivacyNoticeEnabled
  privacyNoticeText = nextPrivacyNoticeText
  queueStatusEnabled = nextQueueStatusEnabled
  const saveSiteSettings = db.transaction(() => {
    saveAppSetting('privacy_notice_enabled', privacyNoticeEnabled)
    saveAppSetting('privacy_notice_text', privacyNoticeText)
    saveAppSetting('queue_status_enabled', queueStatusEnabled)
  })
  saveSiteSettings()
  addLog({ type: 'admin', event: 'settings.site_update', ipHash: getIpHash(req), status: 'success', details: { privacyNoticeEnabled, queueStatusEnabled } })
  res.json({ privacyNoticeEnabled, privacyNoticeText, queueStatusEnabled })
})

app.get('/api/admin/announcements', (_req, res) => {
  const rows = db.prepare('SELECT * FROM announcements ORDER BY pinned DESC, priority DESC, updated_at DESC').all()
  res.json({ announcements: rows.map(serializeAnnouncement) })
})

app.post('/api/admin/announcements', (req, res) => {
  try {
    const item = normalizeAnnouncement(req.body)
    if (!item.title) return res.status(400).json({ error: '请填写公告标题' })
    const timestamp = now()
    const result = db.prepare(`
      INSERT INTO announcements (
        title, content, link_url, link_label, status, show_popup, popup_once, pinned,
        show_bar, dismissible, priority, starts_at, ends_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.title, item.content, item.linkUrl, item.linkLabel, item.status,
      Number(item.showPopup), Number(item.popupOnce), Number(item.pinned), Number(item.showBar),
      Number(item.dismissible), item.priority, item.startsAt, item.endsAt, timestamp, timestamp,
    )
    addLog({ type: 'admin', event: 'announcement.create', ipHash: getIpHash(req), status: 'success', details: { announcementId: result.lastInsertRowid } })
    const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(result.lastInsertRowid)
    res.status(201).json({ announcement: serializeAnnouncement(row) })
  } catch (error) {
    res.status(400).json({ error: sanitizeError(error.message) })
  }
})

app.put('/api/admin/announcements/:id', (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10)
    const current = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id)
    if (!current) return res.status(404).json({ error: '公告不存在' })
    const item = normalizeAnnouncement(req.body)
    if (!item.title) return res.status(400).json({ error: '请填写公告标题' })
    db.prepare(`
      UPDATE announcements SET
        title = ?, content = ?, link_url = ?, link_label = ?, status = ?, show_popup = ?,
        popup_once = ?, pinned = ?, show_bar = ?, dismissible = ?, priority = ?, starts_at = ?,
        ends_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      item.title, item.content, item.linkUrl, item.linkLabel, item.status,
      Number(item.showPopup), Number(item.popupOnce), Number(item.pinned), Number(item.showBar),
      Number(item.dismissible), item.priority, item.startsAt, item.endsAt, now(), id,
    )
    addLog({ type: 'admin', event: 'announcement.update', ipHash: getIpHash(req), status: 'success', details: { announcementId: id } })
    res.json({ announcement: serializeAnnouncement(db.prepare('SELECT * FROM announcements WHERE id = ?').get(id)) })
  } catch (error) {
    res.status(400).json({ error: sanitizeError(error.message) })
  }
})

for (const [action, status] of [['publish', 'published'], ['unpublish', 'offline']]) {
  app.post(`/api/admin/announcements/:id/${action}`, (req, res) => {
    const id = Number.parseInt(req.params.id, 10)
    const result = db.prepare('UPDATE announcements SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id)
    if (!result.changes) return res.status(404).json({ error: '公告不存在' })
    addLog({ type: 'admin', event: `announcement.${action}`, ipHash: getIpHash(req), status: 'success', details: { announcementId: id } })
    res.json({ announcement: serializeAnnouncement(db.prepare('SELECT * FROM announcements WHERE id = ?').get(id)) })
  })
}

app.post('/api/admin/announcements/:id/republish', (req, res) => {
  const id = Number.parseInt(req.params.id, 10)
  const result = db.prepare("UPDATE announcements SET version = version + 1, status = 'published', updated_at = ? WHERE id = ?").run(now(), id)
  if (!result.changes) return res.status(404).json({ error: '公告不存在' })
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id)
  addLog({ type: 'admin', event: 'announcement.republish', ipHash: getIpHash(req), status: 'success', details: { announcementId: id, version: row.version } })
  res.json({ announcement: serializeAnnouncement(row) })
})

app.delete('/api/admin/announcements/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10)
  const result = db.prepare('DELETE FROM announcements WHERE id = ?').run(id)
  if (!result.changes) return res.status(404).json({ error: '公告不存在' })
  addLog({ type: 'admin', event: 'announcement.delete', ipHash: getIpHash(req), status: 'success', details: { announcementId: id } })
  res.status(204).end()
})

function periodStart(period) {
  const days = period === 'today' ? 0 : period === '7d' ? 7 : period === '30d' ? 30 : 3650
  const date = new Date()
  if (days === 0) date.setHours(0, 0, 0, 0)
  else date.setDate(date.getDate() - days)
  return date.toISOString()
}

app.get('/api/admin/stats/summary', (req, res) => {
  const start = periodStart(String(req.query.period ?? '7d'))
  const visits = db.prepare('SELECT COUNT(*) AS count, COUNT(DISTINCT ip_hash) AS unique_ips FROM visit_sessions WHERE session_started_at >= ?').get(start)
  const generations = db.prepare(`
    SELECT COUNT(*) AS requests,
      COALESCE(SUM(CASE WHEN status = 'success' THEN image_count ELSE 0 END), 0) AS images,
      COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successful,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
      ROUND(AVG(CASE WHEN status = 'success' THEN duration_ms END)) AS average_duration_ms
    FROM generation_events WHERE created_at >= ?
  `).get(start)
  const resolutions = db.prepare(`
    SELECT resolution_tier AS tier, COUNT(*) AS requests,
      COALESCE(SUM(CASE WHEN status = 'success' THEN image_count ELSE 0 END), 0) AS images
    FROM generation_events WHERE created_at >= ?
    GROUP BY resolution_tier ORDER BY requests DESC
  `).all(start)
  const modules = db.prepare(`
    SELECT module, COUNT(*) AS requests,
      COALESCE(SUM(CASE WHEN status = 'success' THEN image_count ELSE 0 END), 0) AS images,
      ROUND(AVG(CASE WHEN status = 'success' THEN duration_ms END)) AS average_duration_ms
    FROM generation_events WHERE created_at >= ?
    GROUP BY module ORDER BY requests DESC
  `).all(start)
  const promptOptimization = db.prepare(`
    SELECT COUNT(*) AS requests,
      COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successful,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
      COUNT(DISTINCT ip_hash) AS unique_ips,
      ROUND(AVG(CASE WHEN status = 'success' THEN duration_ms END)) AS average_duration_ms
    FROM logs
    WHERE created_at >= ? AND event IN ('prompt.optimize', 'prompt.optimize_error')
  `).get(start)
  res.json({
    visits: visits.count,
    uniqueIps: visits.unique_ips,
    requests: generations.requests,
    images: generations.images,
    successful: generations.successful,
    failed: generations.failed,
    averageDurationMs: generations.average_duration_ms,
    resolutions,
    modules: modules.map((item) => ({
      module: item.module,
      requests: item.requests,
      images: item.images,
      averageDurationMs: item.average_duration_ms,
    })),
    promptOptimization: {
      requests: promptOptimization.requests,
      successful: promptOptimization.successful,
      failed: promptOptimization.failed,
      uniqueIps: promptOptimization.unique_ips,
      averageDurationMs: promptOptimization.average_duration_ms,
    },
  })
})

app.get('/api/admin/stats/trends', (req, res) => {
  const start = periodStart(String(req.query.period ?? '30d'))
  const visits = db.prepare(`
    SELECT substr(session_started_at, 1, 10) AS date, COUNT(*) AS visits, COUNT(DISTINCT ip_hash) AS unique_ips
    FROM visit_sessions WHERE session_started_at >= ? GROUP BY date ORDER BY date
  `).all(start)
  const generations = db.prepare(`
    SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS requests,
      COALESCE(SUM(CASE WHEN status = 'success' THEN image_count ELSE 0 END), 0) AS images,
      COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successful,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM generation_events WHERE created_at >= ? GROUP BY date ORDER BY date
  `).all(start)
  const promptOptimizations = db.prepare(`
    SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS requests,
      COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successful,
      COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
    FROM logs
    WHERE created_at >= ? AND event IN ('prompt.optimize', 'prompt.optimize_error')
    GROUP BY date ORDER BY date
  `).all(start)
  res.json({ visits, generations, promptOptimizations })
})

app.get('/api/admin/stats/keywords', (req, res) => {
  const start = periodStart(String(req.query.period ?? '30d'))
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit ?? 20, 10) || 20))
  const prompts = db.prepare(`
    SELECT prompt FROM generation_events
    WHERE created_at >= ? AND prompt <> ''
    ORDER BY created_at DESC LIMIT 20000
  `).all(start)
  const counts = new Map()
  for (const row of prompts) {
    for (const keyword of getPromptKeywords(row.prompt)) counts.set(keyword, (counts.get(keyword) ?? 0) + 1)
  }
  const keywords = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, limit)
    .map(([keyword, count]) => ({ keyword, count, percentage: prompts.length ? Math.round(count / prompts.length * 1000) / 10 : 0 }))
  res.json({ totalPrompts: prompts.length, keywords })
})

app.get('/api/admin/generations', (req, res) => {
  const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit ?? 100, 10) || 100))
  const conditions = []
  const params = []
  const ipAddress = String(req.query.ipAddress ?? '').trim()
  const query = String(req.query.q ?? '').trim().slice(0, 200)
  const dateFrom = String(req.query.dateFrom ?? '').trim()
  const dateTo = String(req.query.dateTo ?? '').trim()
  const module = String(req.query.module ?? '').trim()
  if (module && !['gpt', 'sensenova-u1'].includes(module)) return res.status(400).json({ error: '生图模块无效' })
  if (module) {
    conditions.push('module = ?')
    params.push(module)
  }
  if (ipAddress) {
    conditions.push('ip_address = ?')
    params.push(normalizeIp(ipAddress))
  }
  if (query) {
    conditions.push('(prompt LIKE ? OR ip_address LIKE ? OR model LIKE ? OR request_id LIKE ?)')
    params.push(...Array(4).fill(`%${query}%`))
  }
  if (dateFrom) {
    const date = new Date(dateFrom)
    if (!Number.isFinite(date.getTime())) return res.status(400).json({ error: '开始日期无效' })
    conditions.push('created_at >= ?')
    params.push(date.toISOString())
  }
  if (dateTo) {
    const date = new Date(dateTo)
    if (!Number.isFinite(date.getTime())) return res.status(400).json({ error: '结束日期无效' })
    conditions.push('created_at < ?')
    params.push(date.toISOString())
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.prepare(`SELECT * FROM generation_events ${where} ORDER BY created_at DESC LIMIT ?`).all(...params, limit)
  res.json({
    items: rows.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      ipAddress: row.ip_address,
      module: row.module,
      action: row.action,
      endpoint: row.endpoint,
      model: row.model,
      prompt: row.prompt,
      size: row.size,
      resolutionTier: row.resolution_tier,
      quality: row.quality,
      imageCount: row.image_count,
      status: row.status,
      upstreamStatus: row.upstream_status,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    })),
  })
})

app.delete('/api/admin/generations', (req, res) => {
  const result = db.prepare('DELETE FROM generation_events').run()
  addLog({ type: 'admin', event: 'generations.clear', ipHash: getIpHash(req), status: 'success', details: { deletedCount: result.changes } })
  res.json({ deleted: result.changes })
})

app.get('/api/admin/ip-usage', (req, res) => {
  const start = periodStart(String(req.query.period ?? '30d'))
  const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit ?? 100, 10) || 100))
  const rows = db.prepare(`
    WITH activity AS (
      SELECT ip_address, COUNT(*) AS visits, 0 AS requests, 0 AS images, 0 AS successful, 0 AS failed,
        MAX(last_seen_at) AS last_seen_at
      FROM visit_sessions
      WHERE session_started_at >= ? AND ip_address <> ''
      GROUP BY ip_address
      UNION ALL
      SELECT ip_address, 0 AS visits, COUNT(*) AS requests,
        COALESCE(SUM(CASE WHEN status = 'success' THEN image_count ELSE 0 END), 0) AS images,
        COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successful,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
        MAX(created_at) AS last_seen_at
      FROM generation_events
      WHERE created_at >= ? AND ip_address <> ''
      GROUP BY ip_address
    ), totals AS (
      SELECT ip_address, SUM(visits) AS visits, SUM(requests) AS requests, SUM(images) AS images,
        SUM(successful) AS successful, SUM(failed) AS failed, MAX(last_seen_at) AS last_seen_at
      FROM activity GROUP BY ip_address
    )
    SELECT totals.*, blocked_ips.id AS block_id, blocked_ips.reason AS block_reason,
      blocked_ips.created_at AS blocked_at, blocked_ips.expires_at AS block_expires_at
    FROM totals
    LEFT JOIN blocked_ips ON blocked_ips.ip_address = totals.ip_address
      AND (blocked_ips.expires_at IS NULL OR blocked_ips.expires_at > ?)
    ORDER BY totals.requests DESC, totals.visits DESC, totals.last_seen_at DESC
    LIMIT ?
  `).all(start, start, now(), limit)
  res.json({
    items: rows.map((row) => ({
      ipAddress: row.ip_address,
      visits: row.visits,
      requests: row.requests,
      images: row.images,
      successful: row.successful,
      failed: row.failed,
      lastSeenAt: row.last_seen_at,
      blockId: row.block_id ?? null,
      blockReason: row.block_reason ?? '',
      blockedAt: row.blocked_at ?? null,
      blockExpiresAt: row.block_expires_at ?? null,
    })),
  })
})

app.get('/api/admin/ip-blocks', (_req, res) => {
  const rows = db.prepare('SELECT * FROM blocked_ips ORDER BY created_at DESC').all()
  res.json({
    blocks: rows.map((row) => ({
      id: row.id,
      ipAddress: row.ip_address,
      reason: row.reason,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      active: !row.expires_at || row.expires_at > now(),
    })),
  })
})

app.post('/api/admin/ip-blocks', (req, res) => {
  const ipAddress = normalizeIp(req.body.ipAddress)
  if (!isIP(ipAddress)) return res.status(400).json({ error: '请输入有效的 IPv4 或 IPv6 地址' })
  const reason = String(req.body.reason ?? '').trim().slice(0, 200)
  const expiresDate = req.body.expiresAt ? new Date(req.body.expiresAt) : null
  if (expiresDate && !Number.isFinite(expiresDate.getTime())) return res.status(400).json({ error: '封禁到期时间无效' })
  const expiresAt = expiresDate?.toISOString() ?? null
  const createdAt = now()
  db.prepare(`
    INSERT INTO blocked_ips (ip_address, reason, created_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(ip_address) DO UPDATE SET reason = excluded.reason,
      created_at = excluded.created_at, expires_at = excluded.expires_at
  `).run(ipAddress, reason, createdAt, expiresAt)
  const row = db.prepare('SELECT * FROM blocked_ips WHERE ip_address = ?').get(ipAddress)
  addLog({ type: 'admin', event: 'ip.block', ipHash: getIpHash(req), status: 'success', details: { blockId: row.id } })
  res.status(201).json({ id: row.id, ipAddress: row.ip_address, reason: row.reason, createdAt: row.created_at, expiresAt: row.expires_at })
})

app.delete('/api/admin/ip-blocks/:id', (req, res) => {
  const id = Number.parseInt(req.params.id, 10)
  const result = db.prepare('DELETE FROM blocked_ips WHERE id = ?').run(id)
  if (!result.changes) return res.status(404).json({ error: '封禁记录不存在' })
  addLog({ type: 'admin', event: 'ip.unblock', ipHash: getIpHash(req), status: 'success', details: { blockId: id } })
  res.status(204).end()
})

app.get('/api/admin/logs', (req, res) => {
  const conditions = []
  const params = []
  for (const [query, column] of [['type', 'type'], ['level', 'level'], ['status', 'status'], ['requestId', 'request_id']]) {
    const value = String(req.query[query] ?? '').trim()
    if (!value) continue
    conditions.push(`${column} = ?`)
    params.push(value)
  }
  const eventPrefix = String(req.query.eventPrefix ?? '').trim().slice(0, 100)
  if (eventPrefix) {
    conditions.push('event LIKE ?')
    params.push(`${eventPrefix}%`)
  }
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit ?? 50, 10) || 50))
  const offset = Math.max(0, Number.parseInt(req.query.offset ?? 0, 10) || 0)
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const rows = db.prepare(`SELECT * FROM logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
  const count = db.prepare(`SELECT COUNT(*) AS count FROM logs ${where}`).get(...params).count
  res.json({
    total: count,
    logs: rows.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      level: row.level,
      type: row.type,
      event: row.event,
      ipHash: row.ip_hash ? row.ip_hash.slice(0, 12) : '',
      status: row.status,
      durationMs: row.duration_ms,
      details: JSON.parse(row.details_json),
      createdAt: row.created_at,
    })),
  })
})

function cleanup() {
  const requestCutoff = new Date(Date.now() - config.requestLogRetentionDays * 86400_000).toISOString()
  const auditCutoff = new Date(Date.now() - config.auditLogRetentionDays * 86400_000).toISOString()
  const ipCutoff = new Date(Date.now() - config.ipActivityRetentionDays * 86400_000).toISOString()
  db.prepare("DELETE FROM logs WHERE type NOT IN ('admin', 'security') AND created_at < ?").run(requestCutoff)
  db.prepare("DELETE FROM logs WHERE type IN ('admin', 'security') AND created_at < ?").run(auditCutoff)
  db.prepare('DELETE FROM generation_events WHERE created_at < ?').run(ipCutoff)
  db.prepare('DELETE FROM visit_sessions WHERE last_seen_at < ?').run(ipCutoff)
  db.prepare('DELETE FROM admin_sessions WHERE expires_at <= ?').run(now())
}

cleanup()
setInterval(cleanup, 24 * 60 * 60 * 1000).unref()

if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    createReadStream(join(distDir, 'index.html')).pipe(res.type('html'))
  })
}

app.use((error, req, res, _next) => {
  const requestId = randomUUID()
  addLog({ requestId, level: 'error', type: 'system', event: 'server.unhandled', ipHash: getIpHash(req), status: 'failed', details: { message: error.message } })
  res.status(500).json({ error: '服务器内部错误', requestId })
})

app.listen(config.port, config.host, () => {
  console.log(`Server ready at http://${config.host}:${config.port}`)
})
