import { createHash } from 'node:crypto'
import { readPngSize } from '../server/imageDimensions.mjs'

const rawArgs = process.argv.slice(2)
const args = new Set(rawArgs)
const unknownArgs = rawArgs.filter((arg) => arg !== '--confirm-cost' && !arg.startsWith('--tier=') && !arg.startsWith('--channels='))
if (unknownArgs.length) {
  console.error(`未知参数：${unknownArgs.join(', ')}`)
  process.exit(1)
}
const tierArgs = rawArgs.filter((arg) => arg.startsWith('--tier='))
const channelArgs = rawArgs.filter((arg) => arg.startsWith('--channels='))
if (tierArgs.length > 1 || channelArgs.length > 1) {
  console.error('同一参数不能重复传入')
  process.exit(1)
}
const tierArg = tierArgs[0]?.slice('--tier='.length).toUpperCase()
if (tierArg && tierArg !== '2K' && tierArg !== '4K') {
  console.error('tier 仅支持 2K 或 4K')
  process.exit(1)
}
const tier = tierArg || '4K'
const size = tier === '4K' ? '3840x2160' : '2560x1440'
const channelArg = channelArgs[0]?.slice('--channels='.length)
if (channelArgs.length && !channelArg?.trim()) {
  console.error('channels 不能为空')
  process.exit(1)
}
if (channelArg?.split(',').some((channel) => !channel.trim())) {
  console.error('channels 不能包含空线路')
  process.exit(1)
}
const requestedChannels = channelArg
  ? channelArg.split(',').map((channel) => channel.trim()).filter(Boolean)
  : ['primary', 'sixoner', 'catapi']
if (new Set(requestedChannels).size !== requestedChannels.length) {
  console.error('channels 不能包含重复线路')
  process.exit(1)
}
const prompt = 'A photorealistic red electric sports sedan in a clean premium studio, front three-quarter view, realistic materials, controlled reflections, no text, no logos, no watermark.'

const channels = {
  primary: {
    apiUrl: process.env.UPSTREAM_API_URL,
    apiKey: process.env.UPSTREAM_API_KEY,
    model: process.env.UPSTREAM_MODEL || 'gpt-image-2',
  },
  sixoner: {
    apiUrl: process.env.SIXONER_API_URL,
    apiKey: process.env.SIXONER_API_KEY,
    model: tier === '4K'
      ? process.env.SIXONER_4K_MODEL || 'gpt-image-2-4k'
      : process.env.SIXONER_2K_MODEL || 'gpt-image-2-2k',
  },
  catapi: {
    apiUrl: process.env.CATAPI_API_URL,
    apiKey: process.env.CATAPI_API_KEY,
    model: tier === '4K'
      ? process.env.CATAPI_4K_MODEL || 'gpt-image-2-4k'
      : process.env.CATAPI_2K_MODEL || 'gpt-image-2-2k',
  },
}

const unknownChannels = requestedChannels.filter((name) => !channels[name])
if (unknownChannels.length) {
  console.error(`未知线路：${unknownChannels.join(', ')}`)
  process.exit(1)
}
const selected = requestedChannels.map((name) => ({ name, ...channels[name] }))
const missingChannels = selected.filter((channel) => !channel.apiUrl || !channel.apiKey || !channel.model).map((channel) => channel.name)
if (missingChannels.length) {
  console.error(`线路配置不完整：${missingChannels.join(', ')}，请检查 .env.server.local`)
  process.exit(1)
}

if (!args.has('--confirm-cost')) {
  console.log(JSON.stringify({
    dryRun: true,
    message: '真实测试会产生上游费用；确认后添加 --confirm-cost',
    tier,
    size,
    quality: 'high',
    outputFormat: 'png',
    imageCount: 1,
    stream: false,
    channels: selected.map((channel) => ({ channel: channel.name, model: channel.model })),
  }, null, 2))
  process.exit(0)
}

function sanitizeError(value) {
  const redacted = Object.values(channels)
    .map((channel) => channel.apiKey)
    .filter(Boolean)
    .reduce((text, key) => text.split(key).join('[REDACTED]'), String(value ?? ''))
  return redacted
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[REDACTED]')
    .replace(/https?:\/\/\S+/gi, '[URL]')
    .slice(0, 400)
}

function readUpstreamError(status, text) {
  try {
    const payload = JSON.parse(text)
    const code = typeof payload?.error?.code === 'string' ? payload.error.code : typeof payload?.code === 'string' ? payload.code : ''
    const message = typeof payload?.error?.message === 'string' ? payload.error.message : typeof payload?.message === 'string' ? payload.message : ''
    return sanitizeError(`HTTP ${status}${code ? ` ${code}` : ''}${message ? `：${message}` : ''}`)
  } catch {
    return `HTTP ${status}`
  }
}

function readMetadata(payload) {
  const item = Array.isArray(payload?.data) ? payload.data[0] : undefined
  return {
    responseModel: typeof payload?.model === 'string' ? payload.model : '',
    responseQuality: typeof item?.quality === 'string' ? item.quality : typeof payload?.quality === 'string' ? payload.quality : '',
    responseSize: typeof item?.size === 'string' ? item.size : typeof payload?.size === 'string' ? payload.size : '',
    item,
  }
}

async function readImage(item) {
  if (typeof item?.b64_json === 'string') {
    const encoded = item.b64_json.includes(',') ? item.b64_json.slice(item.b64_json.indexOf(',') + 1) : item.b64_json
    return { source: 'b64_json', bytes: Buffer.from(encoded, 'base64'), downloadMs: 0 }
  }
  if (typeof item?.url !== 'string' || !/^https?:\/\//i.test(item.url)) throw new Error('响应没有可读取的 b64_json 或 URL')

  const startedAt = Date.now()
  const response = await fetch(item.url, { signal: AbortSignal.timeout(120_000) })
  if (!response.ok) throw new Error(`图片 URL 下载失败：HTTP ${response.status}`)
  return {
    source: 'url',
    bytes: Buffer.from(await response.arrayBuffer()),
    downloadMs: Date.now() - startedAt,
  }
}

const results = []
for (const channel of selected) {
  const startedAt = Date.now()
  try {
    const response = await fetch(`${channel.apiUrl.replace(/\/+$/, '')}/images/generations`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${channel.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        model: channel.model,
        prompt,
        size,
        quality: 'high',
        output_format: 'png',
        n: 1,
        stream: false,
      }),
      signal: AbortSignal.timeout(600_000),
    })
    const headersMs = Date.now() - startedAt
    const text = await response.text()
    const totalMs = Date.now() - startedAt
    if (!response.ok) throw new Error(readUpstreamError(response.status, text))

    const payload = JSON.parse(text)
    const metadata = readMetadata(payload)
    const image = await readImage(metadata.item)
    const actualSize = readPngSize(image.bytes)
    results.push({
      channel: channel.name,
      requestModel: channel.model,
      httpStatus: response.status,
      headersMs,
      totalMs: totalMs + image.downloadMs,
      imageSource: image.source,
      responseModel: metadata.responseModel || null,
      responseQuality: metadata.responseQuality || null,
      responseSize: metadata.responseSize || null,
      actualSize: actualSize || null,
      requestedSizeMatched: actualSize === size,
      imageBytes: image.bytes.byteLength,
      imageSha256: createHash('sha256').update(image.bytes).digest('hex').slice(0, 16),
    })
  } catch (error) {
    results.push({
      channel: channel.name,
      requestModel: channel.model,
      error: sanitizeError(error instanceof Error ? error.message : error),
      totalMs: Date.now() - startedAt,
    })
    process.exitCode = 1
  }
}

console.log(JSON.stringify({
  testedAt: new Date().toISOString(),
  tier,
  requestedSize: size,
  quality: 'high',
  stream: false,
  results,
}, null, 2))
