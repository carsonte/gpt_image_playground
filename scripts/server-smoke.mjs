import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

const dataDir = await mkdtemp(join(tmpdir(), 'gpt-image-server-test-'))
const port = 18788
const upstreamPort = 18789
const origin = `http://127.0.0.1:${port}`
let upstreamActive = 0
let maxUpstreamActive = 0
let upstreamPrompts = []
let upstreamPayloads = []
let upstreamPaths = []
let upstreamBodies = []
const upstream = createServer(async (req, res) => {
  upstreamPaths.push(req.url)
  const chunks = []
  await new Promise((resolve) => {
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', resolve)
  })
  const rawBody = Buffer.concat(chunks)
  upstreamBodies.push({ path: req.url, text: rawBody.toString('latin1') })
  let payload = null
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
    if (typeof payload.prompt === 'string') upstreamPrompts.push(payload.prompt)
    upstreamPayloads.push(payload)
  } catch {
    // multipart 请求无需参与 JSON 顺序断言。
  }
  upstreamActive += 1
  maxUpstreamActive = Math.max(maxUpstreamActive, upstreamActive)
  if (req.url === '/catapi/v1/images/generations' && payload?.prompt === '响应传输完成测试') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{"data":[')
    await new Promise((resolve) => setTimeout(resolve, 300))
    res.end(']}')
    upstreamActive -= 1
    return
  }
  if (req.url === '/catapi/v1/images/generations' && payload?.prompt === '响应体中途断开测试') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write('{"data":[{"b64_json":"truncated')
    setTimeout(() => {
      res.destroy()
      upstreamActive -= 1
    }, 50)
    return
  }
  if (payload?.prompt === 'SSE 不回退测试') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    res.write('data: {"type":"response.output_text.delta","delta":"stream"}\n\n')
    await new Promise((resolve) => setTimeout(resolve, 40))
    res.end('data: [DONE]\n\n')
    upstreamActive -= 1
    return
  }
  if (payload?.prompt === '质量自动回退测试' || payload?.prompt === '质量不回退测试') {
    const quality = req.url === '/catapi/v1/images/generations' ? 'low' : 'high'
    await new Promise((resolve) => setTimeout(resolve, 40))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ quality, data: [{ quality, size: '2880x2880', b64_json: Buffer.from(quality).toString('base64') }] }))
    upstreamActive -= 1
    return
  }
  if (payload?.prompt === '尺寸自动回退测试') {
    const size = req.url === '/catapi/v1/images/generations' ? '2048x2048' : '2880x2880'
    await new Promise((resolve) => setTimeout(resolve, 40))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ size, b64_json: Buffer.from(size).toString('base64') }] }))
    upstreamActive -= 1
    return
  }
  if (payload?.prompt === '质量参数诊断测试') {
    await new Promise((resolve) => setTimeout(resolve, 40))
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ quality: 'low', data: [{ b64_json: 'bG93LXF1YWxpdHk=' }] }))
    upstreamActive -= 1
    return
  }
  await new Promise((resolve) => setTimeout(resolve, 120))
  const shouldFailCatApi = req.url === '/catapi/v1/images/generations' && ['一只戴墨镜的橘猫', 'CatAPI 转 Sixoner 测试'].includes(payload?.prompt)
  const shouldFailSixoner = req.url === '/sixoner/v1/images/generations' && payload?.prompt === '一只戴墨镜的橘猫'
  const shouldFailAll = payload?.prompt === '全部线路失败测试' && req.url?.endsWith('/images/generations')
  const status = shouldFailCatApi || shouldFailSixoner || shouldFailAll ? 502 : 200
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(shouldFailAll
    ? { error: { message: '模拟上游故障' } }
    : req.url === '/v1/chat/completions'
    ? { choices: [{ message: { content: '优化后的 U1 信息图提示词，完整保留价格“19.9 元”' } }] }
    : { data: [] }))
  upstreamActive -= 1
})
await new Promise((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve))
const serverEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD: 'test-password',
  SESSION_SECRET: 'test-session-secret-with-sufficient-length',
  STATS_HASH_SECRET: 'test-stats-secret-with-sufficient-length',
  UPSTREAM_API_URL: `http://127.0.0.1:${upstreamPort}/v1`,
  UPSTREAM_API_KEY: 'test-upstream-key',
  UPSTREAM_CONCURRENCY: '1',
  SIXONER_API_URL: `http://127.0.0.1:${upstreamPort}/sixoner/v1`,
  SIXONER_API_KEY: 'test-sixoner-key',
  SIXONER_MODEL: 'gpt-image-2',
  SIXONER_2K_MODEL: 'gpt-image-2-2k',
  SIXONER_4K_MODEL: 'gpt-image-2-4k',
  CATAPI_API_URL: `http://127.0.0.1:${upstreamPort}/catapi/v1`,
  CATAPI_API_KEY: 'test-catapi-key',
  CATAPI_MODEL: 'gpt-image-2',
  CATAPI_2K_MODEL: 'gpt-image-2-2k',
  CATAPI_4K_MODEL: 'gpt-image-2-4k',
  SENSENOVA_API_URL: `http://127.0.0.1:${upstreamPort}/v1`,
  SENSENOVA_API_KEY: 'test-sensenova-key',
  SENSENOVA_CONCURRENCY: '1',
  DOTS_API_URL: `http://127.0.0.1:${upstreamPort}`,
  DOTS_API_KEY: 'test-dots-key',
}

function spawnServer(serverPort, serverDataDir, overrides = {}) {
  return spawn(process.execPath, ['server/index.mjs'], {
    env: { ...process.env, ...serverEnvironment, PORT: String(serverPort), DATA_DIR: serverDataDir, ...overrides },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

const child = spawnServer(port, dataDir)

async function waitForOrigin(targetOrigin) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${targetOrigin}/api/health`)
      if (response.ok) return
    } catch {
      // 服务启动期间继续轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('服务启动超时')
}

async function waitForServer() {
  return waitForOrigin(origin)
}

async function request(path, init = {}) {
  const response = await fetch(`${origin}${path}`, init)
  const payload = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(`${path} 请求失败：${JSON.stringify(payload)}`)
  return { response, payload }
}

async function rawRequest(path, init = {}) {
  const response = await fetch(`${origin}${path}`, init)
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    // SSE 或其他非 JSON 响应保留原始文本。
  }
  return { response, text, payload }
}

function adminHeaders(cookie, originHeader = true) {
  return { 'Content-Type': 'application/json', Cookie: cookie, ...(originHeader ? { Origin: origin } : {}) }
}

async function updateQueueSettings(cookie, patch) {
  return request('/api/admin/settings/queue', {
    method: 'PUT',
    headers: adminHeaders(cookie),
    body: JSON.stringify(patch),
  })
}

try {
  await waitForServer()
  const login = await request('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ username: 'admin', password: 'test-password' }),
  })
  const cookie = login.response.headers.get('set-cookie')?.split(';')[0]
  if (!cookie) throw new Error('登录响应缺少会话 Cookie')

  const initialQueueSettings = await request('/api/admin/settings/queue', { headers: { Cookie: cookie } })
  if (initialQueueSettings.payload.concurrency !== 1 || initialQueueSettings.payload.perIpConcurrency !== 2 || initialQueueSettings.payload.perIpQueueLimit !== 3) throw new Error('队列默认配置不正确')
  if (initialQueueSettings.payload.gptChannel !== 'sixoner' || !initialQueueSettings.payload.primaryConfigured || !initialQueueSettings.payload.sixonerConfigured || !initialQueueSettings.payload.catApiConfigured) throw new Error('GPT 生图渠道默认配置不正确')
  const recommendedRoutes = {
    generate: { '2K': ['sixoner', 'catapi', 'primary'], '4K': ['sixoner', 'catapi', 'primary'] },
    edit: { '2K': ['sixoner', 'catapi', 'primary'], '4K': ['sixoner', 'catapi', 'primary'] },
  }
  if (JSON.stringify(initialQueueSettings.payload.gptRoutes) !== JSON.stringify(recommendedRoutes) || JSON.stringify(initialQueueSettings.payload.recommendedGptRoutes) !== JSON.stringify(recommendedRoutes) || initialQueueSettings.payload.streamEnabled !== true || initialQueueSettings.payload.streamMode !== 'client' || initialQueueSettings.payload.autoFallbackOnMismatch !== false || JSON.stringify(initialQueueSettings.payload.configured) !== JSON.stringify({ primary: true, sixoner: true, catapi: true })) throw new Error('GPT 四组推荐路由或流式默认配置不正确')
  const customRoutes = {
    generate: { '2K': ['catapi', 'sixoner', 'primary'], '4K': ['catapi', 'sixoner', 'primary'] },
    edit: { '2K': ['catapi', 'sixoner', 'primary'], '4K': ['catapi', 'sixoner', 'primary'] },
  }
  const updatedQueueSettings = await request('/api/admin/settings/queue', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ concurrency: 2, perIpConcurrency: 1, perIpQueueLimit: 2, senseNovaConcurrency: 2, senseNovaPerIpConcurrency: 1, senseNovaPerIpQueueLimit: 2, streamEnabled: true, autoFallbackOnMismatch: false, gptRoutes: customRoutes }),
  })
  if (updatedQueueSettings.payload.concurrency !== 2 || updatedQueueSettings.payload.perIpConcurrency !== 1 || updatedQueueSettings.payload.perIpQueueLimit !== 2) throw new Error('后台队列配置未生效')
   if (updatedQueueSettings.payload.gptChannel !== 'catapi' || JSON.stringify(updatedQueueSettings.payload.gptRoutes) !== JSON.stringify(customRoutes)) throw new Error('GPT 四组路由顺序切换未生效')
  const publicQueueSettings = await request('/api/queue/status')
  if (publicQueueSettings.payload.concurrency !== 2) throw new Error('前台队列状态未同步后台配置')
  const senseNovaQueueSettings = await request('/api/queue/status?module=sensenova-u1')
  if (senseNovaQueueSettings.payload.concurrency !== 2) throw new Error('U1 独立队列配置不正确')
  await request('/api/admin/settings/queue', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ concurrency: 1, perIpConcurrency: 1, perIpQueueLimit: 3, gptChannel: 'catapi' }),
  })
  const initialSiteSettings = await request('/api/admin/settings/site', { headers: { Cookie: cookie } })
  if (!initialSiteSettings.payload.privacyNoticeEnabled || !initialSiteSettings.payload.queueStatusEnabled) throw new Error('首页提示默认配置不正确')
  const updatedSiteSettings = await request('/api/admin/settings/site', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ privacyNoticeEnabled: true, privacyNoticeText: '测试本地提示文字', queueStatusEnabled: false }),
  })
  if (updatedSiteSettings.payload.privacyNoticeText !== '测试本地提示文字' || updatedSiteSettings.payload.queueStatusEnabled) throw new Error('后台首页提示配置未生效')
  const publicSiteSettings = await request('/api/site-config')
  if (publicSiteSettings.payload.privacyNoticeText !== '测试本地提示文字' || publicSiteSettings.payload.queueStatusEnabled) throw new Error('前台首页提示配置未同步')

  const optimizedPrompt = await request('/api/prompt/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '做一张咖啡知识卡片，价格“19.9 元”', module: 'sensenova-u1', size: '2496x1664' }),
  })
  if (!optimizedPrompt.payload.prompt.includes('19.9 元')) throw new Error('U1 提示词优化未保留原始数据')
  const dotsPayload = upstreamPayloads.find((item) => item.model === 'dots3-note-prev')
  if (dotsPayload?.chat_template_kwargs?.enable_thinking !== false || dotsPayload?.stream !== false) throw new Error('Dots 提示词优化参数不正确')
  if (!dotsPayload.messages?.[0]?.content.includes('只读数据') || !dotsPayload.messages?.[1]?.content.includes('2496x1664')) throw new Error('Dots 数据保护或画布尺寸提示缺失')
  const rejectedGptOptimization = await fetch(`${origin}/api/prompt/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '生成一只猫', module: 'gpt' }),
  })
  if (rejectedGptOptimization.status !== 400) throw new Error('GPT 模块不应开放提示词优化')

  const invalidOrigin = await fetch(`${origin}/api/admin/logout`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: 'invalid-origin' },
  })
  if (invalidOrigin.status !== 403) throw new Error('异常 Origin 未被拒绝')

  const invalidAnnouncementLink = await fetch(`${origin}/api/admin/announcements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ title: '异常链接', linkUrl: '//example.com' }),
  })
  if (invalidAnnouncementLink.status !== 400) throw new Error('协议相对公告链接未被拒绝')

  const created = await request('/api/admin/announcements', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({
      title: '冒烟测试公告',
      content: '测试公告正文',
      showPopup: true,
      popupOnce: true,
      pinned: true,
      showBar: true,
      dismissible: true,
    }),
  })
  const id = created.payload.announcement.id
  await request(`/api/admin/announcements/${id}/publish`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin },
  })
  const publicResult = await request('/api/announcements')
  if (publicResult.payload.announcements[0]?.id !== id) throw new Error('已发布公告未出现在公共接口')

  await request('/api/visits', { method: 'POST' })
  const rejectedImageCount = await fetch(`${origin}/api-proxy/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '数量限制测试', n: 2 }),
  })
  if (rejectedImageCount.status !== 400) throw new Error('服务器未拒绝单次多图请求')
  const gptImageResult = await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test-image-model', prompt: '一只戴墨镜的橘猫', size: '2880x2880', quality: 'high', n: 1 }),
  })
  if (!upstreamPaths.includes('/catapi/v1/images/generations')) throw new Error('GPT 请求未转发到 CatAPI 线路')
  if (!upstreamPaths.includes('/sixoner/v1/images/generations') || !upstreamPaths.includes('/v1/images/generations') || gptImageResult.response.headers.get('x-image-upstream') !== 'primary') throw new Error(`CatAPI 和 Sixoner 失败后未自动转发到 BlackEngine 备用线路: ${JSON.stringify({ paths: upstreamPaths, upstream: gptImageResult.response.headers.get('x-image-upstream') })}`)
  const fallbackPayloads = upstreamPayloads.filter((item) => item.prompt === '一只戴墨镜的橘猫')
  if (fallbackPayloads[0]?.model !== 'gpt-image-2-4k' || fallbackPayloads[1]?.model !== 'gpt-image-2-4k' || fallbackPayloads[2]?.model !== 'gpt-image-2' || fallbackPayloads.some((item) => item.quality !== 'high') || gptImageResult.response.headers.get('x-image-model') !== 'gpt-image-2') throw new Error('4K 回退请求未按各渠道模型和质量分别转发')
  const fallbackLogs = await request('/api/admin/logs?eventPrefix=image.proxy_fallback', { headers: { Cookie: cookie } })
  if (fallbackLogs.payload.total !== 2 || !fallbackLogs.payload.logs.some((item) => item.details?.from === 'catapi' && item.details?.to === 'sixoner') || !fallbackLogs.payload.logs.some((item) => item.details?.from === 'sixoner' && item.details?.to === 'primary')) throw new Error('GPT 生图三级回退日志不正确')
  await request('/api/generation-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: gptImageResult.response.headers.get('x-request-id'), outputSize: '1024x1536' }),
  })
  await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Image-Module': 'sensenova-u1' },
    body: JSON.stringify({ model: 'wrong-model', prompt: 'U1 信息图测试', size: '2048x2048', quality: 'high', n: 1, output_format: 'png' }),
  })
  const senseNovaPayload = upstreamPayloads.find((item) => item.prompt === 'U1 信息图测试')
  if (JSON.stringify(senseNovaPayload) !== JSON.stringify({ model: 'sensenova-u1-fast', prompt: 'U1 信息图测试', size: '2048x2048', n: 1, watermark: false })) throw new Error('U1 请求未按官方参数转发')
  const summary = await request('/api/admin/stats/summary?period=7d', { headers: { Cookie: cookie } })
  if (summary.payload.visits !== 1 || summary.payload.uniqueIps !== 1) throw new Error('访问统计结果不正确')
  if (summary.payload.requests !== 2 || summary.payload.images !== 2 || !summary.payload.resolutions.some((item) => item.tier === '4K') || !summary.payload.resolutions.some((item) => item.tier === '2K')) throw new Error('生图与分辨率统计结果不正确')
  if (!summary.payload.modules.some((item) => item.module === 'sensenova-u1' && item.requests === 1)) throw new Error('U1 独立统计结果不正确')
  if (!Number.isFinite(summary.payload.averageDurationMs) || summary.payload.averageDurationMs < 100) throw new Error('平均完成耗时统计结果不正确')
  if (summary.payload.promptOptimization?.requests !== 1 || summary.payload.promptOptimization.successful !== 1 || summary.payload.promptOptimization.failed !== 0 || summary.payload.promptOptimization.uniqueIps !== 1 || !Number.isFinite(summary.payload.promptOptimization.averageDurationMs)) throw new Error('提示词优化用量统计结果不正确')
  const trends = await request('/api/admin/stats/trends?period=30d', { headers: { Cookie: cookie } })
  if (!trends.payload.promptOptimizations.some((item) => item.requests === 1 && item.successful === 1)) throw new Error('提示词优化趋势统计结果不正确')
  const optimizationLogs = await request('/api/admin/logs?eventPrefix=prompt.optimize', { headers: { Cookie: cookie } })
  if (optimizationLogs.payload.total !== 1 || optimizationLogs.payload.logs[0]?.event !== 'prompt.optimize' || !Number.isFinite(optimizationLogs.payload.logs[0]?.details?.inputLength)) throw new Error('提示词优化调用记录筛选结果不正确')

  const generations = await request('/api/admin/generations', { headers: { Cookie: cookie } })
  if (generations.payload.items[0]?.prompt !== 'U1 信息图测试' || generations.payload.items[0]?.module !== 'sensenova-u1') throw new Error('U1 提示词审计或模块记录不正确')
  const gptGenerations = await request('/api/admin/generations?module=gpt', { headers: { Cookie: cookie } })
  if (gptGenerations.payload.items[0]?.prompt !== '一只戴墨镜的橘猫' || gptGenerations.payload.items[0]?.model !== 'gpt-image-2') throw new Error('GPT 模块筛选结果不正确')
  if (gptGenerations.payload.items[0]?.upstreamChannel !== 'primary' || gptGenerations.payload.items[0]?.routePath !== 'catapi → sixoner → primary') throw new Error('GPT 实际线路记录不正确')
  if (gptGenerations.payload.items[0]?.size !== '2880x2880' || gptGenerations.payload.items[0]?.resolutionTier !== '4K' || gptGenerations.payload.items[0]?.outputSize !== '1024x1536' || gptGenerations.payload.items[0]?.outputResolutionTier !== '1K') throw new Error('GPT 输入和实际输出尺寸记录不正确')
  if (gptGenerations.payload.items[0]?.status !== 'success' || !Number.isFinite(gptGenerations.payload.items[0]?.durationMs)) throw new Error('GPT 状态和耗时记录不正确')
  const searched = await request('/api/admin/generations?q=墨镜', { headers: { Cookie: cookie } })
  if (searched.payload.items.length !== 1) throw new Error('生成记录文字搜索结果不正确')
  const future = await request('/api/admin/generations?dateFrom=2999-01-01T00:00:00.000Z', { headers: { Cookie: cookie } })
  if (future.payload.items.length !== 0) throw new Error('生成记录日期筛选结果不正确')
  const keywords = await request('/api/admin/stats/keywords?period=30d', { headers: { Cookie: cookie } })
  if (!keywords.payload.keywords.some((item) => item.keyword === '橘猫' && item.count === 1)) throw new Error('热门关键词统计结果不正确')

  const failedResponse = await fetch(`${origin}/api-proxy/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '全部线路失败测试', size: '2880x2880', n: 1 }),
  })
  if (failedResponse.status !== 502) throw new Error('全部线路失败时未返回最终上游错误')
  const failedPayload = await failedResponse.json()
  if (failedPayload.error?.message !== '模拟上游故障') throw new Error('最终上游错误内容未完整返回浏览器')
  const errorLogs = await request('/api/admin/logs?errors=1&limit=20', { headers: { Cookie: cookie } })
  const errorLog = errorLogs.payload.logs.find((item) => item.requestId === failedResponse.headers.get('x-request-id'))
  if (errorLog?.event !== 'image.proxy' || errorLog?.status !== 'failed' || errorLog?.details?.message !== '{"error":{"message":"模拟上游故障"}}') throw new Error('独立报错记录未保存最终上游错误')
  const failedGeneration = await request('/api/admin/generations?q=全部线路失败测试', { headers: { Cookie: cookie } })
  if (failedGeneration.payload.items[0]?.status !== 'failed' || !failedGeneration.payload.items[0]?.errorSummary.includes('模拟上游故障')) throw new Error('生成失败记录未保存错误摘要')

  await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '旧客户端 1K 升级测试', size: '1024x1536', n: 1 }),
  })
  const promotedPayload = upstreamPayloads.find((item) => item.prompt === '旧客户端 1K 升级测试')
  if (promotedPayload?.size !== '1440x2160' || promotedPayload?.model !== 'gpt-image-2-2k') throw new Error('旧客户端 1K 请求未升级为对应比例的 2K')

  const deliveryRequest = fetch(`${origin}/api-proxy/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '响应传输完成测试', size: '2048x2048', n: 1 }),
  })
  let activeDuringDelivery
  for (let attempt = 0; attempt < 30; attempt += 1) {
    activeDuringDelivery = await request('/api/admin/queue/tasks', { headers: { Cookie: cookie } })
    if (activeDuringDelivery.payload.active.length === 1) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  if (activeDuringDelivery.payload.active.length !== 1) throw new Error('图片响应尚未传输完成时任务提前离开生成中列表')
  const recordDuringDelivery = await request('/api/admin/generations?q=响应传输完成测试', { headers: { Cookie: cookie } })
  if (recordDuringDelivery.payload.items[0]?.status !== 'started') throw new Error('图片响应尚未传输完成时生成记录被提前标记完成')
  const deliveryResponse = await deliveryRequest
  const deliveryPayload = upstreamPayloads.find((item) => item.prompt === '响应传输完成测试')
  if (deliveryPayload?.model !== 'gpt-image-2-2k' || deliveryResponse.headers.get('x-image-model') !== 'gpt-image-2-2k') throw new Error('CatAPI 2K 请求未使用专用模型')
  await deliveryResponse.json()
  const recordAfterDelivery = await request('/api/admin/generations?q=响应传输完成测试', { headers: { Cookie: cookie } })
  if (recordAfterDelivery.payload.items[0]?.status !== 'success' || recordAfterDelivery.payload.items[0]?.durationMs < 300) throw new Error('图片响应传输完成后生成记录未正确完成')

  const truncatedResponse = await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '响应体中途断开测试', size: '2048x2048', n: 1 }),
  })
  if (truncatedResponse.response.headers.get('x-image-upstream') !== 'sixoner') throw new Error('上游响应体中途断开后未切换备用线路')
  const truncatedFallbackLogs = await request('/api/admin/logs?eventPrefix=image.proxy_fallback', { headers: { Cookie: cookie } })
  const truncatedFallback = truncatedFallbackLogs.payload.logs.find((item) => item.requestId === truncatedResponse.response.headers.get('x-request-id'))
  if (truncatedFallback?.details?.phase !== 'response_body' || !Number.isFinite(truncatedFallback?.details?.bodyMs)) throw new Error('响应体中途断开未记录响应体阶段诊断信息')
  const truncatedProxyLogs = await request('/api/admin/logs?eventPrefix=image.proxy', { headers: { Cookie: cookie } })
  const truncatedProxy = truncatedProxyLogs.payload.logs.find((item) => item.requestId === truncatedResponse.response.headers.get('x-request-id'))
  if (!Number.isFinite(truncatedProxy?.details?.requestBytes) || truncatedProxy?.details?.routeAttempts !== 2) throw new Error('代理成功记录缺少请求体大小或线路尝试次数')

  await request('/api/admin/settings/queue', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ concurrency: 1, perIpConcurrency: 1, perIpQueueLimit: 3, senseNovaConcurrency: 2, senseNovaPerIpConcurrency: 1, senseNovaPerIpQueueLimit: 2, gptChannel: 'sixoner' }),
  })
  const forcedSixoner2kResult = await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Sixoner 模式 2K 强制 CatAPI 测试', size: '2048x2048', n: 1 }),
  })
  const forcedSixoner2kPayload = upstreamPayloads.find((item) => item.prompt === 'Sixoner 模式 2K 强制 CatAPI 测试')
  if (forcedSixoner2kPayload?.model !== 'gpt-image-2-2k' || forcedSixoner2kResult.response.headers.get('x-image-upstream') !== 'sixoner') throw new Error('旧 gptChannel 兼容映射未命中 Sixoner 2K')
  await request('/api/admin/settings/queue', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ concurrency: 1, perIpConcurrency: 1, perIpQueueLimit: 3, senseNovaConcurrency: 2, senseNovaPerIpConcurrency: 1, senseNovaPerIpQueueLimit: 2, gptChannel: 'catapi' }),
  })

  const catApi4kResult = await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'wrong-model', prompt: 'CatAPI 4K 模型路由测试', size: '2880x2880', output_format: 'webp', output_compression: 80, n: 1 }),
  })
  const catApi4kPayload = upstreamPayloads.find((item) => item.prompt === 'CatAPI 4K 模型路由测试')
  if (catApi4kPayload?.model !== 'gpt-image-2-4k' || catApi4kResult.response.headers.get('x-image-model') !== 'gpt-image-2-4k') throw new Error('CatAPI 4K 请求未使用专用模型')
  if (catApi4kPayload?.output_format !== 'png' || 'output_compression' in catApi4kPayload) throw new Error('GPT 生图请求未强制使用 PNG')

  const sixonerFallbackResult = await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'wrong-model', prompt: 'CatAPI 转 Sixoner 测试', size: '2880x2880', n: 1 }),
  })
  const sixonerFallbackPayloads = upstreamPayloads.filter((item) => item.prompt === 'CatAPI 转 Sixoner 测试')
  if (sixonerFallbackPayloads.length !== 2 || sixonerFallbackPayloads.some((item) => item.model !== 'gpt-image-2-4k') || sixonerFallbackResult.response.headers.get('x-image-upstream') !== 'sixoner') throw new Error('CatAPI 失败后未优先回退到 Sixoner 4K 模型')

  const editForm = new FormData()
  editForm.append('model', 'wrong-model')
  editForm.append('prompt', 'CatAPI 4K 编辑模型路由测试')
  editForm.append('size', '2880x2880')
  editForm.append('output_format', 'webp')
  editForm.append('image[]', new Blob(['test-image'], { type: 'image/png' }), 'test.png')
  await request('/api-proxy/images/edits', {
    method: 'POST',
    headers: {
      'X-Image-Action': 'edit',
      'X-Image-Prompt-B64': Buffer.from('CatAPI 4K 编辑模型路由测试').toString('base64'),
      'X-Image-Params-B64': Buffer.from(JSON.stringify({ size: '2880x2880', output_format: 'webp', n: 1 })).toString('base64'),
    },
    body: editForm,
  })
  const edit4kBody = upstreamBodies.findLast((item) => item.path === '/catapi/v1/images/edits')?.text ?? ''
  if (!edit4kBody.includes('name="model"\r\n\r\ngpt-image-2-4k\r\n')) throw new Error('CatAPI 4K 编辑请求未使用专用模型')
  if (!edit4kBody.includes('name="output_format"\r\n\r\npng\r\n') || edit4kBody.includes('name="output_format"\r\n\r\nwebp\r\n')) throw new Error('GPT 编辑请求未强制使用 PNG')
  if (!edit4kBody.includes('name="quality"\r\n\r\nhigh\r\n')) throw new Error('GPT 编辑请求未补齐 high 质量参数')
  if (!edit4kBody.includes('name="n"\r\n\r\n1\r\n')) throw new Error('GPT 编辑请求未强制使用单张输出')
  if (!edit4kBody.includes('name="image[]"; filename="test.png"')) throw new Error('GPT 编辑请求未携带输入图片')
  const editGeneration = await request('/api/admin/generations?q=CatAPI%204K%20编辑模型路由测试', { headers: { Cookie: cookie } })
  if (editGeneration.payload.items[0]?.action !== 'edit' || editGeneration.payload.items[0]?.endpoint !== '/images/edits') throw new Error('GPT 编辑请求未被后台识别为编辑图片')

  const qualityResult = await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '质量参数诊断测试', size: '2880x2880', quality: 'high', n: 1 }),
  })
  const qualityPayload = upstreamPayloads.find((item) => item.prompt === '质量参数诊断测试')
  if (qualityPayload?.quality !== 'high') throw new Error('GPT 请求未保留 high 质量参数')
  const qualityLogs = await request(`/api/admin/logs?requestId=${qualityResult.response.headers.get('x-request-id')}`, { headers: { Cookie: cookie } })
  const qualityLog = qualityLogs.payload.logs.find((item) => item.event === 'image.proxy')
  if (qualityLog?.details?.requestedQuality !== 'high' || qualityLog?.details?.responseQuality !== 'low' || qualityLog?.details?.qualityMismatch !== true) throw new Error('上游质量不一致未记录诊断字段')
  const qualityGeneration = await request('/api/admin/generations?q=质量参数诊断测试', { headers: { Cookie: cookie } })
  if (qualityGeneration.payload.items[0]?.quality !== 'high' || qualityGeneration.payload.items[0]?.outputQuality !== 'low') throw new Error('生成记录未保存请求和实际上游质量')
  await request('/api/generation-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: qualityResult.response.headers.get('x-request-id'), outputQuality: 'low' }),
  })
  await request('/api/generation-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: qualityResult.response.headers.get('x-request-id'), outputSize: '1x1' }),
  })
  const qualityGenerationAfterReport = await request('/api/admin/generations?q=质量参数诊断测试', { headers: { Cookie: cookie } })
  if (qualityGenerationAfterReport.payload.items[0]?.outputSize !== '1x1') throw new Error('生成结果回报未接受单数字尺寸')

  const usage = await request('/api/admin/ip-usage?period=30d', { headers: { Cookie: cookie } })
  const localIp = usage.payload.items.find((item) => item.ipAddress === '127.0.0.1')
  if (!localIp || localIp.visits !== 1) throw new Error('真实 IP 用量统计结果不正确')

  const blocked = await request('/api/admin/ip-blocks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ ipAddress: '127.0.0.1', reason: '冒烟测试' }),
  })
  const rejected = await fetch(`${origin}/api-proxy/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test', n: 1 }),
  })
  if (rejected.status !== 403) throw new Error('被拉黑 IP 的生图请求未被拒绝')
  await request(`/api/admin/ip-blocks/${blocked.payload.id}`, {
    method: 'DELETE',
    headers: { Cookie: cookie, Origin: origin },
  })

  await request('/api/admin/settings/queue', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ concurrency: 2, perIpConcurrency: 1, perIpQueueLimit: 1 }),
  })
  maxUpstreamActive = 0
  const limitedIpHeaders = { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.10' }
  const firstLimitedRequest = fetch(`${origin}/api-proxy/images/generations`, {
    method: 'POST',
    headers: limitedIpHeaders,
    body: JSON.stringify({ prompt: 'IP 限制测试一' }),
  })
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await request('/api/queue/status')
    if (status.payload.active === 1) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const secondLimitedRequest = fetch(`${origin}/api-proxy/images/generations`, {
    method: 'POST',
    headers: limitedIpHeaders,
    body: JSON.stringify({ prompt: 'IP 限制测试二' }),
  })
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await request('/api/queue/status')
    if (status.payload.waiting === 1) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const rejectedByIpLimit = await fetch(`${origin}/api-proxy/images/generations`, {
    method: 'POST',
    headers: limitedIpHeaders,
    body: JSON.stringify({ prompt: 'IP 限制测试三' }),
  })
  if (rejectedByIpLimit.status !== 429 || rejectedByIpLimit.headers.get('retry-after') !== '10') throw new Error('单 IP 超额请求未被限流')
  const otherIpRequest = fetch(`${origin}/api-proxy/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.20' },
    body: JSON.stringify({ prompt: '其他 IP 公平调度测试' }),
  })
  let observedFairScheduling = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const liveTasks = await request('/api/admin/queue/tasks', { headers: { Cookie: cookie } })
    if (liveTasks.payload.active.some((item) => item.ipAddress === '198.51.100.20') && liveTasks.payload.waiting.some((item) => item.ipAddress === '198.51.100.10')) {
      observedFairScheduling = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const limitedResponses = await Promise.all([firstLimitedRequest, secondLimitedRequest, otherIpRequest])
  if (limitedResponses.some((response) => !response.ok) || !observedFairScheduling || maxUpstreamActive !== 2) throw new Error('不同 IP 未获得公平并发调度')
  await request('/api/admin/settings/queue', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ concurrency: 1, perIpConcurrency: 1, perIpQueueLimit: 3 }),
  })

  maxUpstreamActive = 0
  upstreamPrompts = []
  const firstQueuedRequest = fetch(`${origin}/api-proxy/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '队列测试一' }),
  })
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await request('/api/queue/status')
    if (status.payload.active === 1) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const secondQueuedRequest = fetch(`${origin}/api-proxy/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '队列测试二' }),
  })
  let observedWaiting = false
  let observedLiveIp = false
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const status = await request('/api/queue/status')
    if (status.payload.active === 1 && status.payload.waiting === 1) {
      observedWaiting = true
      const liveTasks = await request('/api/admin/queue/tasks', { headers: { Cookie: cookie } })
      observedLiveIp = liveTasks.payload.active[0]?.ipAddress === '127.0.0.1' && liveTasks.payload.waiting[0]?.ipAddress === '127.0.0.1'
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const queuedResponses = await Promise.all([firstQueuedRequest, secondQueuedRequest])
  if (queuedResponses.some((response) => !response.ok)) throw new Error('队列中的生图请求失败')
  if (!observedWaiting || maxUpstreamActive !== 1) throw new Error('全站生图请求未按并发上限排队')
  if (!observedLiveIp) throw new Error('实时任务未显示真实 IP')
  if (upstreamPrompts.join(',') !== '队列测试一,队列测试二') throw new Error('全站生图请求未按提交顺序执行')

  // 四组路由应彼此独立，并在保存后立即用于新请求。
  const independentRoutes = {
    generate: { '2K': ['primary', 'sixoner'], '4K': ['catapi', 'primary'] },
    edit: { '2K': ['sixoner', 'primary'], '4K': ['primary', 'catapi'] },
  }
  await updateQueueSettings(cookie, {
    concurrency: 1,
    perIpConcurrency: 1,
    perIpQueueLimit: 3,
    gptRoutes: independentRoutes,
    streamEnabled: false,
    autoFallbackOnMismatch: false,
  })
  const independentGenerate2k = await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '独立路由生成 2K', size: '2048x2048', n: 1 }),
  })
  const independentGenerate4k = await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '独立路由生成 4K', size: '2880x2880', n: 1 }),
  })
  if (independentGenerate2k.response.headers.get('x-image-upstream') !== 'primary' || independentGenerate4k.response.headers.get('x-image-upstream') !== 'catapi') throw new Error('生成 2K/4K 未分别命中独立路由组')
  const independentEdit2kForm = new FormData()
  independentEdit2kForm.append('prompt', '独立路由编辑 2K')
  independentEdit2kForm.append('size', '2048x2048')
  independentEdit2kForm.append('image[]', new Blob(['test-image'], { type: 'image/png' }), 'input.png')
  const independentEdit2k = await request('/api-proxy/images/edits', { method: 'POST', body: independentEdit2kForm })
  const independentEdit4kForm = new FormData()
  independentEdit4kForm.append('prompt', '独立路由编辑 4K')
  independentEdit4kForm.append('size', '2880x2880')
  independentEdit4kForm.append('image[]', new Blob(['test-image'], { type: 'image/png' }), 'input.png')
  const independentEdit4k = await request('/api-proxy/images/edits', { method: 'POST', body: independentEdit4kForm })
  if (independentEdit2k.response.headers.get('x-image-upstream') !== 'sixoner' || independentEdit4k.response.headers.get('x-image-upstream') !== 'primary') throw new Error('编辑 2K/4K 未分别命中独立路由组')

  // 全站流式开关同时影响 Images、multipart 和 Responses 请求体。
  await updateQueueSettings(cookie, { gptRoutes: independentRoutes, streamEnabled: true, autoFallbackOnMismatch: false })
  await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '流式 JSON 请求体测试', size: '2048x2048', stream: true, partial_images: 2, n: 1 }),
  })
  const streamJsonPayload = upstreamPayloads.findLast((item) => item.prompt === '流式 JSON 请求体测试')
  if (streamJsonPayload?.stream !== true || streamJsonPayload?.partial_images !== 2) throw new Error('流式开启时 JSON 请求体未保留 stream 参数')
  await updateQueueSettings(cookie, { streamEnabled: false })
  await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '关闭流式 JSON 请求体测试', size: '2048x2048', stream: true, partial_images: 2, n: 1 }),
  })
  const nonStreamJsonPayload = upstreamPayloads.findLast((item) => item.prompt === '关闭流式 JSON 请求体测试')
  if (nonStreamJsonPayload && ('stream' in nonStreamJsonPayload || 'partial_images' in nonStreamJsonPayload)) throw new Error('流式关闭时 JSON 请求体仍包含 stream 参数')

  await updateQueueSettings(cookie, { streamEnabled: true })
  const enabledMultipart = new FormData()
  enabledMultipart.append('prompt', '流式 multipart 请求体测试')
  enabledMultipart.append('size', '2048x2048')
  enabledMultipart.append('stream', 'true')
  enabledMultipart.append('partial_images', '2')
  enabledMultipart.append('image[]', new Blob(['test-image'], { type: 'image/png' }), 'input.png')
  await request('/api-proxy/images/edits', { method: 'POST', body: enabledMultipart })
  const enabledMultipartBody = upstreamBodies.findLast((item) => item.path === '/sixoner/v1/images/edits' || item.path === '/catapi/v1/images/edits' || item.path === '/v1/images/edits')?.text ?? ''
  if (!enabledMultipartBody.includes('name="stream"') || !enabledMultipartBody.includes('\r\n\r\ntrue\r\n') || !enabledMultipartBody.includes('name="partial_images"')) throw new Error('流式开启时 multipart 字段未转发')
  await updateQueueSettings(cookie, { streamEnabled: false })
  const disabledMultipart = new FormData()
  disabledMultipart.append('prompt', '关闭流式 multipart 请求体测试')
  disabledMultipart.append('size', '2048x2048')
  disabledMultipart.append('stream', 'true')
  disabledMultipart.append('partial_images', '2')
  disabledMultipart.append('image[]', new Blob(['test-image'], { type: 'image/png' }), 'input.png')
  await request('/api-proxy/images/edits', { method: 'POST', body: disabledMultipart })
  const disabledMultipartBody = upstreamBodies.findLast((item) => item.path === '/sixoner/v1/images/edits' || item.path === '/catapi/v1/images/edits' || item.path === '/v1/images/edits')?.text ?? ''
  if (disabledMultipartBody.includes('name="stream"') || disabledMultipartBody.includes('name="partial_images"')) throw new Error('流式关闭时 multipart 字段未移除')

  await updateQueueSettings(cookie, { streamEnabled: true })
  await request('/api-proxy/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'responses stream test', stream: true, tools: [{ type: 'image_generation', size: '2880x2880', partial_images: 2 }] }),
  })
  const streamResponsesPayload = upstreamPayloads.findLast((item) => item.input === 'responses stream test')
  if (streamResponsesPayload?.stream !== true || streamResponsesPayload.tools?.[0]?.partial_images !== 2) throw new Error('Responses 流式开启时请求体未保留 stream 参数')
  await updateQueueSettings(cookie, { streamEnabled: false })
  await request('/api-proxy/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'responses nonstream test', stream: true, partial_images: 2, tools: [{ type: 'image_generation', size: '2880x2880', partial_images: 2 }] }),
  })
  const nonStreamResponsesPayload = upstreamPayloads.findLast((item) => item.input === 'responses nonstream test')
  if (nonStreamResponsesPayload && ('stream' in nonStreamResponsesPayload || 'partial_images' in nonStreamResponsesPayload || nonStreamResponsesPayload.tools?.[0]?.partial_images !== undefined)) throw new Error('Responses 流式关闭时请求体仍包含 stream 参数')

  // 自动质量/尺寸回退只对完整 JSON 生效，SSE 不应重复请求。
  const mismatchRoutes = {
    generate: { '2K': ['catapi', 'sixoner', 'primary'], '4K': ['catapi', 'sixoner', 'primary'] },
    edit: { '2K': ['catapi', 'sixoner', 'primary'], '4K': ['catapi', 'sixoner', 'primary'] },
  }
  await updateQueueSettings(cookie, { gptRoutes: mismatchRoutes, streamEnabled: false, autoFallbackOnMismatch: true })
  const mismatchResult = await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '质量自动回退测试', size: '2880x2880', quality: 'high', n: 1 }),
  })
  if (mismatchResult.response.headers.get('x-image-upstream') !== 'sixoner' || upstreamPayloads.filter((item) => item.prompt === '质量自动回退测试').length !== 2) throw new Error('开启自动质量回退后未切换到下一条线路')
  const mismatchLogs = await request(`/api/admin/logs?requestId=${mismatchResult.response.headers.get('x-request-id')}`, { headers: { Cookie: cookie } })
  if (!mismatchLogs.payload.logs.some((item) => item.event === 'image.proxy_fallback' && item.details?.fallbackReason === 'quality_mismatch')) throw new Error('质量不匹配回退日志缺少原因')
  await updateQueueSettings(cookie, { autoFallbackOnMismatch: false })
  const noMismatchResult = await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '质量不回退测试', size: '2880x2880', quality: 'high', n: 1 }),
  })
  if (noMismatchResult.response.headers.get('x-image-upstream') !== 'catapi' || upstreamPayloads.filter((item) => item.prompt === '质量不回退测试').length !== 1) throw new Error('关闭自动质量回退后不应重复请求')
  await updateQueueSettings(cookie, { autoFallbackOnMismatch: true })
  const sizeMismatchResult = await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: '尺寸自动回退测试', size: '2880x2880', quality: 'high', n: 1 }),
  })
  if (sizeMismatchResult.response.headers.get('x-image-upstream') !== 'sixoner') throw new Error('开启自动尺寸回退后未切换到下一条线路')
  const sizeMismatchLogs = await request(`/api/admin/logs?requestId=${sizeMismatchResult.response.headers.get('x-request-id')}`, { headers: { Cookie: cookie } })
  if (!sizeMismatchLogs.payload.logs.some((item) => item.event === 'image.proxy_fallback' && item.details?.fallbackReason === 'size_mismatch')) throw new Error('尺寸不匹配回退日志缺少原因')
  const sseResult = await rawRequest('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'SSE 不回退测试', size: '2880x2880', stream: true, n: 1 }),
  })
  if (!sseResult.response.ok || !sseResult.response.headers.get('content-type')?.includes('text/event-stream') || sseResult.response.headers.get('x-image-upstream') !== 'catapi' || !sseResult.text.includes('[DONE]')) throw new Error('SSE 响应未按实际类型流式返回')
  const sseLogs = await request(`/api/admin/logs?requestId=${sseResult.response.headers.get('x-request-id')}`, { headers: { Cookie: cookie } })
  if (sseLogs.payload.logs.some((item) => item.event === 'image.proxy_fallback')) throw new Error('SSE 响应不应触发质量回退')

  // 设置更新后，已占用槽位保持旧快照，等待中的请求使用新设置。
  const oldSnapshotRoutes = { generate: { '2K': ['catapi', 'sixoner'], '4K': ['catapi', 'sixoner'] }, edit: { '2K': ['catapi', 'sixoner'], '4K': ['catapi', 'sixoner'] } }
  const newSnapshotRoutes = { generate: { '2K': ['primary', 'sixoner'], '4K': ['primary', 'sixoner'] }, edit: { '2K': ['primary', 'sixoner'], '4K': ['primary', 'sixoner'] } }
  await updateQueueSettings(cookie, { concurrency: 1, perIpConcurrency: 1, perIpQueueLimit: 3, gptRoutes: oldSnapshotRoutes, streamEnabled: false, autoFallbackOnMismatch: false })
  const runningSnapshotRequest = fetch(`${origin}/api-proxy/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '响应传输完成测试', size: '2048x2048', n: 1 }) })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await request('/api/queue/status')
    if (status.payload.active === 1) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const waitingSnapshotRequest = fetch(`${origin}/api-proxy/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '排队设置快照测试', size: '2880x2880', stream: true, n: 1 }) })
  let observedSnapshotWaiting = false
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = await request('/api/queue/status')
    if (status.payload.waiting === 1) {
      observedSnapshotWaiting = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  await updateQueueSettings(cookie, { gptRoutes: newSnapshotRoutes, streamEnabled: true })
  const [runningSnapshotResponse, waitingSnapshotResponse] = await Promise.all([runningSnapshotRequest, waitingSnapshotRequest])
  const waitingSnapshotPayload = upstreamPayloads.findLast((item) => item.prompt === '排队设置快照测试')
  if (!observedSnapshotWaiting || !runningSnapshotResponse.ok || !waitingSnapshotResponse.ok || runningSnapshotResponse.headers.get('x-image-upstream') !== 'catapi' || waitingSnapshotResponse.headers.get('x-image-upstream') !== 'primary' || waitingSnapshotPayload?.stream !== true) throw new Error('运行中与排队请求未分别使用旧/新路由和流式快照')

  // 重启后自定义路由保持；恢复推荐设置只改路由和流式开关。
  const persistedRoutes = newSnapshotRoutes
  await updateQueueSettings(cookie, { concurrency: 2, perIpConcurrency: 2, perIpQueueLimit: 5, gptRoutes: persistedRoutes, streamEnabled: false, autoFallbackOnMismatch: true })
  const restartPort = port + 2
  const restartOrigin = `http://127.0.0.1:${restartPort}`
  const restartedChild = spawnServer(restartPort, dataDir)
  try {
    await waitForOrigin(restartOrigin)
    const restartedHealth = await (await fetch(`${restartOrigin}/api/health`)).json()
    if (JSON.stringify(restartedHealth.gptRoutes) !== JSON.stringify(persistedRoutes) || restartedHealth.streamEnabled !== false || restartedHealth.autoFallbackOnMismatch !== true) throw new Error('自定义路由或流式设置重启后未持久化')
  } finally {
    restartedChild.kill('SIGTERM')
    await new Promise((resolve) => restartedChild.once('exit', resolve))
  }
  const siteBeforeReset = await request('/api/site-config')
  const resetResult = await request('/api/admin/settings/reset', { method: 'POST', headers: adminHeaders(cookie), body: JSON.stringify({ scope: 'routing' }) })
  if (resetResult.payload.queue.concurrency !== 2 || resetResult.payload.queue.perIpConcurrency !== 2 || resetResult.payload.queue.perIpQueueLimit !== 5 || resetResult.payload.queue.streamEnabled !== true || resetResult.payload.queue.autoFallbackOnMismatch !== false || JSON.stringify(resetResult.payload.queue.gptRoutes) !== JSON.stringify(recommendedRoutes)) throw new Error('恢复推荐设置未正确保留队列或恢复路由')
  const siteAfterReset = await request('/api/site-config')
  if (JSON.stringify(siteAfterReset.payload) !== JSON.stringify(siteBeforeReset.payload)) throw new Error('恢复推荐设置意外修改首页设置')

  // 仅配置 BlackEngine 时跳过未配置线路；全部线路都未配置时返回 503。
  const partialDataDir = await mkdtemp(join(tmpdir(), 'gpt-image-server-partial-'))
  const partialPort = port + 3
  const partialOrigin = `http://127.0.0.1:${partialPort}`
  const partialChild = spawnServer(partialPort, partialDataDir, { SIXONER_API_KEY: '', CATAPI_API_KEY: '' })
  try {
    await waitForOrigin(partialOrigin)
    const partialResponse = await fetch(`${partialOrigin}/api-proxy/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '未配置线路跳过测试', size: '2880x2880', n: 1 }) })
    if (!partialResponse.ok || partialResponse.headers.get('x-image-upstream') !== 'primary') throw new Error('未配置线路未被跳过')
  } finally {
    partialChild.kill('SIGTERM')
    await new Promise((resolve) => partialChild.once('exit', resolve))
    await rm(partialDataDir, { recursive: true, force: true })
  }
  const unavailableDataDir = await mkdtemp(join(tmpdir(), 'gpt-image-server-unavailable-'))
  const unavailablePort = port + 4
  const unavailableOrigin = `http://127.0.0.1:${unavailablePort}`
  const unavailableChild = spawnServer(unavailablePort, unavailableDataDir, { UPSTREAM_API_KEY: '', SIXONER_API_KEY: '', CATAPI_API_KEY: '' })
  try {
    await waitForOrigin(unavailableOrigin)
    const unavailableResponse = await fetch(`${unavailableOrigin}/api-proxy/images/generations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: '全部线路未配置测试', size: '2880x2880', n: 1 }) })
    if (unavailableResponse.status !== 503) throw new Error('全部线路未配置时未返回 503')
  } finally {
    unavailableChild.kill('SIGTERM')
    await new Promise((resolve) => unavailableChild.once('exit', resolve))
    await rm(unavailableDataDir, { recursive: true, force: true })
  }

  const logs = await request('/api/admin/logs?limit=100', { headers: { Cookie: cookie } })
  if (!logs.payload.logs.some((item) => item.event === 'announcement.publish')) throw new Error('公告发布日志缺失')
  const clearedGenerations = await request('/api/admin/generations', { method: 'DELETE', headers: { Cookie: cookie, Origin: origin } })
  if (clearedGenerations.payload.deleted < 1) throw new Error('清空生成记录未删除数据')
  const emptyGenerations = await request('/api/admin/generations', { headers: { Cookie: cookie } })
  if (emptyGenerations.payload.items.length !== 0) throw new Error('清空生成记录后仍存在旧数据')
  console.log('Server smoke test passed')
} finally {
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('exit', resolve))
  await new Promise((resolve) => upstream.close(resolve))
  await rm(dataDir, { recursive: true, force: true })
}
