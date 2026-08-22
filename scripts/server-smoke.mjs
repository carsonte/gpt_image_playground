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
const upstream = createServer(async (req, res) => {
  const chunks = []
  await new Promise((resolve) => {
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', resolve)
  })
  try {
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof payload.prompt === 'string') upstreamPrompts.push(payload.prompt)
  } catch {
    // multipart 请求无需参与 JSON 顺序断言。
  }
  upstreamActive += 1
  maxUpstreamActive = Math.max(maxUpstreamActive, upstreamActive)
  await new Promise((resolve) => setTimeout(resolve, 120))
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ data: [] }))
  upstreamActive -= 1
})
await new Promise((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve))
const child = spawn(process.execPath, ['server/index.mjs'], {
  env: {
    ...process.env,
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: dataDir,
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'test-password',
    SESSION_SECRET: 'test-session-secret-with-sufficient-length',
    STATS_HASH_SECRET: 'test-stats-secret-with-sufficient-length',
    UPSTREAM_API_URL: `http://127.0.0.1:${upstreamPort}/v1`,
    UPSTREAM_API_KEY: 'test-upstream-key',
    UPSTREAM_CONCURRENCY: '1',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`)
      if (response.ok) return
    } catch {
      // 服务启动期间继续轮询。
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('服务启动超时')
}

async function request(path, init = {}) {
  const response = await fetch(`${origin}${path}`, init)
  const payload = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(`${path} 请求失败：${JSON.stringify(payload)}`)
  return { response, payload }
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
  if (initialQueueSettings.payload.concurrency !== 1 || initialQueueSettings.payload.perIpConcurrency !== 1 || initialQueueSettings.payload.perIpQueueLimit !== 3) throw new Error('队列默认配置不正确')
  const updatedQueueSettings = await request('/api/admin/settings/queue', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ concurrency: 2, perIpConcurrency: 1, perIpQueueLimit: 2 }),
  })
  if (updatedQueueSettings.payload.concurrency !== 2 || updatedQueueSettings.payload.perIpConcurrency !== 1 || updatedQueueSettings.payload.perIpQueueLimit !== 2) throw new Error('后台队列配置未生效')
  const publicQueueSettings = await request('/api/queue/status')
  if (publicQueueSettings.payload.concurrency !== 2) throw new Error('前台队列状态未同步后台配置')
  await request('/api/admin/settings/queue', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: origin },
    body: JSON.stringify({ concurrency: 1, perIpConcurrency: 1, perIpQueueLimit: 3 }),
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
  await request('/api-proxy/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'test-image-model', prompt: '一只戴墨镜的橘猫', size: '2048x2048', quality: 'high', n: 2 }),
  })
  const summary = await request('/api/admin/stats/summary?period=7d', { headers: { Cookie: cookie } })
  if (summary.payload.visits !== 1 || summary.payload.uniqueIps !== 1) throw new Error('访问统计结果不正确')
  if (summary.payload.requests !== 1 || summary.payload.images !== 2 || summary.payload.resolutions[0]?.tier !== '2K') throw new Error('生图与分辨率统计结果不正确')
  if (!Number.isFinite(summary.payload.averageDurationMs) || summary.payload.averageDurationMs < 100) throw new Error('平均完成耗时统计结果不正确')

  const generations = await request('/api/admin/generations', { headers: { Cookie: cookie } })
  if (generations.payload.items[0]?.prompt !== '一只戴墨镜的橘猫' || generations.payload.items[0]?.size !== '2048x2048' || generations.payload.items[0]?.model !== 'gpt-image-2') throw new Error('提示词审计或固定模型记录不正确')
  const searched = await request('/api/admin/generations?q=墨镜', { headers: { Cookie: cookie } })
  if (searched.payload.items.length !== 1) throw new Error('生成记录文字搜索结果不正确')
  const future = await request('/api/admin/generations?dateFrom=2999-01-01T00:00:00.000Z', { headers: { Cookie: cookie } })
  if (future.payload.items.length !== 0) throw new Error('生成记录日期筛选结果不正确')
  const keywords = await request('/api/admin/stats/keywords?period=30d', { headers: { Cookie: cookie } })
  if (!keywords.payload.keywords.some((item) => item.keyword === '橘猫' && item.count === 1)) throw new Error('热门关键词统计结果不正确')

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

  const logs = await request('/api/admin/logs?limit=20', { headers: { Cookie: cookie } })
  if (!logs.payload.logs.some((item) => item.event === 'announcement.publish')) throw new Error('公告发布日志缺失')
  console.log('Server smoke test passed')
} finally {
  child.kill('SIGTERM')
  await new Promise((resolve) => child.once('exit', resolve))
  await new Promise((resolve) => upstream.close(resolve))
  await rm(dataDir, { recursive: true, force: true })
}
