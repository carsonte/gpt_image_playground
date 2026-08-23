import { useEffect, useState, type FormEvent } from 'react'
import {
  apiRequest,
  EMPTY_ANNOUNCEMENT,
  type Announcement,
  type AnnouncementDraft,
} from '../lib/announcementApi'

type Tab = 'dashboard' | 'live' | 'generations' | 'announcements' | 'ips' | 'logs' | 'settings'

const ADMIN_NAV_GROUPS: Array<{ label: string; items: Array<[Tab, string]> }> = [
  { label: '监控', items: [['dashboard', '数据看板'], ['live', '实时任务'], ['generations', '生成记录']] },
  { label: '运营', items: [['announcements', '公告管理'], ['ips', 'IP 管理'], ['logs', '日志中心']] },
  { label: '系统', items: [['settings', '系统设置']] },
]

type Summary = {
  visits: number
  uniqueIps: number
  requests: number
  images: number
  successful: number
  failed: number
  averageDurationMs: number | null
  resolutions: Array<{ tier: string; requests: number; images: number }>
  modules: Array<{ module: 'gpt' | 'sensenova-u1'; requests: number; images: number; averageDurationMs: number | null }>
}

type DailyTrend = {
  date: string
  visits: number
  uniqueIps: number
  requests: number
  images: number
  successful: number
  failed: number
}

type KeywordStat = {
  keyword: string
  count: number
  percentage: number
}

type QueueSettings = {
  concurrency: number
  perIpConcurrency: number
  perIpQueueLimit: number
  active: number
  waiting: number
  senseNovaConcurrency: number
  senseNovaPerIpConcurrency: number
  senseNovaPerIpQueueLimit: number
  senseNovaActive: number
  senseNovaWaiting: number
  senseNovaConfigured: boolean
}

type SiteSettings = {
  privacyNoticeEnabled: boolean
  privacyNoticeText: string
  queueStatusEnabled: boolean
}

type LiveQueueTask = {
  requestId: string
  module: 'gpt' | 'sensenova-u1'
  ipAddress: string
  action: 'generate' | 'edit'
  endpoint: string
  prompt: string
  size: string
  imageCount: number
  queuedAt: string
  startedAt?: string
  position?: number
  waitMs: number
  runtimeMs?: number
}

type LiveQueueStatus = {
  concurrency: number
  perIpConcurrency: number
  perIpQueueLimit: number
  active: LiveQueueTask[]
  waiting: LiveQueueTask[]
}

type LogItem = {
  id: number
  requestId: string
  level: string
  type: string
  event: string
  ipHash: string
  status: string
  durationMs: number | null
  details: Record<string, unknown>
  createdAt: string
}

type IpUsage = {
  ipAddress: string
  visits: number
  requests: number
  images: number
  successful: number
  failed: number
  lastSeenAt: string
  blockId: number | null
  blockReason: string
}

type IpBlock = {
  id: number
  ipAddress: string
  reason: string
  createdAt: string
  expiresAt: string | null
  active: boolean
}

type GenerationRecord = {
  id: number
  requestId: string
  ipAddress: string
  module: 'gpt' | 'sensenova-u1'
  action: 'generate' | 'edit'
  model: string
  prompt: string
  size: string
  resolutionTier: string
  quality: string
  imageCount: number
  status: 'started' | 'success' | 'failed'
  durationMs: number | null
  createdAt: string
}

function localDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN') : '—'
}

function formatDuration(value: number | null) {
  if (value == null) return '—'
  if (value < 1000) return `${value} ms`
  if (value < 60_000) return `${Math.round(value / 100) / 10} 秒`
  const minutes = Math.floor(value / 60_000)
  const seconds = Math.round(value % 60_000 / 1000)
  return `${minutes} 分 ${seconds} 秒`
}

function toDateInput(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function fieldClass() {
  return 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 dark:border-white/[0.1] dark:bg-gray-900'
}

export default function AdminApp() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('dashboard')
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<Summary | null>(null)
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [editing, setEditing] = useState<Announcement | null>(null)
  const [draft, setDraft] = useState<AnnouncementDraft>(EMPTY_ANNOUNCEMENT)
  const [logs, setLogs] = useState<LogItem[]>([])
  const [logType, setLogType] = useState('')
  const [ipUsage, setIpUsage] = useState<IpUsage[]>([])
  const [ipBlocks, setIpBlocks] = useState<IpBlock[]>([])
  const [dailyTrend, setDailyTrend] = useState<DailyTrend[]>([])
  const [generations, setGenerations] = useState<GenerationRecord[]>([])
  const [generationIp, setGenerationIp] = useState('')
  const [generationQuery, setGenerationQuery] = useState('')
  const [generationDateFrom, setGenerationDateFrom] = useState('')
  const [generationDateTo, setGenerationDateTo] = useState('')
  const [generationModule, setGenerationModule] = useState('')
  const [topKeywords, setTopKeywords] = useState<KeywordStat[]>([])
  const [queueSettings, setQueueSettings] = useState<QueueSettings | null>(null)
  const [queueConcurrency, setQueueConcurrency] = useState('4')
  const [perIpConcurrency, setPerIpConcurrency] = useState('2')
  const [perIpQueueLimit, setPerIpQueueLimit] = useState('3')
  const [senseNovaConcurrencyInput, setSenseNovaConcurrencyInput] = useState('2')
  const [senseNovaPerIpConcurrencyInput, setSenseNovaPerIpConcurrencyInput] = useState('1')
  const [senseNovaPerIpQueueLimitInput, setSenseNovaPerIpQueueLimitInput] = useState('2')
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null)
  const [liveQueue, setLiveQueue] = useState<LiveQueueStatus | null>(null)

  const loadDashboard = () => Promise.all([
    apiRequest<Summary>('/api/admin/stats/summary?period=30d'),
    apiRequest<{ visits: Array<{ date: string; visits: number; unique_ips: number }>; generations: Array<{ date: string; requests: number; images: number; successful: number; failed: number }> }>('/api/admin/stats/trends?period=30d'),
    apiRequest<{ keywords: KeywordStat[] }>('/api/admin/stats/keywords?period=30d&limit=20'),
  ]).then(([nextSummary, trends, keywordResult]) => {
    setSummary(nextSummary)
    setTopKeywords(keywordResult.keywords)
    const dates = [...new Set([...trends.visits.map((item) => item.date), ...trends.generations.map((item) => item.date)])].sort()
    setDailyTrend(dates.map((date) => {
      const visit = trends.visits.find((item) => item.date === date)
      const generation = trends.generations.find((item) => item.date === date)
      return { date, visits: visit?.visits ?? 0, uniqueIps: visit?.unique_ips ?? 0, requests: generation?.requests ?? 0, images: generation?.images ?? 0, successful: generation?.successful ?? 0, failed: generation?.failed ?? 0 }
    }))
  })
  const loadLiveQueue = () => apiRequest<LiveQueueStatus>('/api/admin/queue/tasks').then(setLiveQueue)
  const loadSettings = () => Promise.all([
    apiRequest<QueueSettings>('/api/admin/settings/queue'),
    apiRequest<SiteSettings>('/api/admin/settings/site'),
  ]).then(([nextQueueSettings, nextSiteSettings]) => {
    setQueueSettings(nextQueueSettings)
    setQueueConcurrency(String(nextQueueSettings.concurrency))
    setPerIpConcurrency(String(nextQueueSettings.perIpConcurrency))
    setPerIpQueueLimit(String(nextQueueSettings.perIpQueueLimit))
    setSenseNovaConcurrencyInput(String(nextQueueSettings.senseNovaConcurrency))
    setSenseNovaPerIpConcurrencyInput(String(nextQueueSettings.senseNovaPerIpConcurrency))
    setSenseNovaPerIpQueueLimitInput(String(nextQueueSettings.senseNovaPerIpQueueLimit))
    setSiteSettings(nextSiteSettings)
  })
  const loadAnnouncements = () => apiRequest<{ announcements: Announcement[] }>('/api/admin/announcements').then((result) => setAnnouncements(result.announcements))
  const loadLogs = () => apiRequest<{ logs: LogItem[] }>(`/api/admin/logs?limit=100${logType ? `&type=${encodeURIComponent(logType)}` : ''}`).then((result) => setLogs(result.logs))
  const loadIps = () => Promise.all([
    apiRequest<{ items: IpUsage[] }>('/api/admin/ip-usage?period=30d&limit=200'),
    apiRequest<{ blocks: IpBlock[] }>('/api/admin/ip-blocks'),
  ]).then(([usage, blocks]) => {
    setIpUsage(usage.items)
    setIpBlocks(blocks.blocks)
  })
  const loadGenerations = () => {
    const params = new URLSearchParams({ limit: '200' })
    if (generationIp.trim()) params.set('ipAddress', generationIp.trim())
    if (generationQuery.trim()) params.set('q', generationQuery.trim())
    if (generationDateFrom) params.set('dateFrom', new Date(`${generationDateFrom}T00:00:00`).toISOString())
    if (generationDateTo) params.set('dateTo', new Date(new Date(`${generationDateTo}T00:00:00`).getTime() + 86400_000).toISOString())
    if (generationModule) params.set('module', generationModule)
    return apiRequest<{ items: GenerationRecord[] }>(`/api/admin/generations?${params}`).then((result) => setGenerations(result.items))
  }

  const saveQueueSettings = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      const result = await apiRequest<QueueSettings>('/api/admin/settings/queue', {
        method: 'PUT',
        body: JSON.stringify({
          concurrency: Number(queueConcurrency),
          perIpConcurrency: Number(perIpConcurrency),
          perIpQueueLimit: Number(perIpQueueLimit),
          senseNovaConcurrency: Number(senseNovaConcurrencyInput),
          senseNovaPerIpConcurrency: Number(senseNovaPerIpConcurrencyInput),
          senseNovaPerIpQueueLimit: Number(senseNovaPerIpQueueLimitInput),
        }),
      })
      setQueueSettings(result)
      setQueueConcurrency(String(result.concurrency))
      setPerIpConcurrency(String(result.perIpConcurrency))
      setPerIpQueueLimit(String(result.perIpQueueLimit))
      setSenseNovaConcurrencyInput(String(result.senseNovaConcurrency))
      setSenseNovaPerIpConcurrencyInput(String(result.senseNovaPerIpConcurrency))
      setSenseNovaPerIpQueueLimitInput(String(result.senseNovaPerIpQueueLimit))
    } catch (err) {
      setError(err instanceof Error ? err.message : '队列设置保存失败')
    }
  }

  const saveSiteSettings = async (event: FormEvent) => {
    event.preventDefault()
    if (!siteSettings) return
    setError('')
    try {
      const result = await apiRequest<SiteSettings>('/api/admin/settings/site', {
        method: 'PUT',
        body: JSON.stringify(siteSettings),
      })
      setSiteSettings(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : '首页提示设置保存失败')
    }
  }

  useEffect(() => {
    void apiRequest<{ username: string }>('/api/admin/session')
      .then((result) => {
        setUsername(result.username)
        setAuthenticated(true)
      })
      .catch(() => setAuthenticated(false))
  }, [])

  useEffect(() => {
    if (!authenticated) return
    setError('')
    const action = tab === 'dashboard' ? Promise.all([loadDashboard(), loadLiveQueue()]) : tab === 'live' ? loadLiveQueue() : tab === 'settings' ? loadSettings() : tab === 'generations' ? loadGenerations() : tab === 'announcements' ? loadAnnouncements() : tab === 'ips' ? loadIps() : loadLogs()
    void action.catch((err) => setError(err.message))
  }, [authenticated, tab, logType, generationIp, generationQuery, generationDateFrom, generationDateTo, generationModule])

  useEffect(() => {
    if (!authenticated || (tab !== 'dashboard' && tab !== 'live')) return
    const timer = window.setInterval(() => void loadLiveQueue().catch(() => {}), 2000)
    return () => window.clearInterval(timer)
  }, [authenticated, tab])

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      const result = await apiRequest<{ username: string }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setUsername(result.username)
      setPassword('')
      setAuthenticated(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    }
  }

  const logout = async () => {
    await apiRequest('/api/admin/logout', { method: 'POST' })
    setAuthenticated(false)
  }

  const startCreate = () => {
    setEditing(null)
    setDraft({ ...EMPTY_ANNOUNCEMENT })
  }

  const startEdit = (item: Announcement) => {
    setEditing(item)
    setDraft({
      title: item.title,
      content: item.content,
      linkUrl: item.linkUrl,
      linkLabel: item.linkLabel,
      status: item.status,
      showPopup: item.showPopup,
      popupOnce: item.popupOnce,
      pinned: false,
      showBar: item.showBar || item.pinned,
      dismissible: item.dismissible,
      priority: item.priority,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    })
  }

  const saveAnnouncement = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      await apiRequest(editing ? `/api/admin/announcements/${editing.id}` : '/api/admin/announcements', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(draft),
      })
      setEditing(null)
      setDraft({ ...EMPTY_ANNOUNCEMENT })
      await loadAnnouncements()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  const announcementAction = async (item: Announcement, action: 'publish' | 'unpublish' | 'republish' | 'delete') => {
    if (action === 'delete' && !window.confirm(`确定永久删除公告“${item.title}”吗？`)) return
    await apiRequest(`/api/admin/announcements/${item.id}${action === 'delete' ? '' : `/${action}`}`, {
      method: action === 'delete' ? 'DELETE' : 'POST',
    })
    await loadAnnouncements()
  }

  const blockIp = async (item: IpUsage) => {
    const reason = window.prompt(`拉黑 ${item.ipAddress} 的原因：`, '疑似滥用')
    if (reason === null) return
    await apiRequest('/api/admin/ip-blocks', {
      method: 'POST',
      body: JSON.stringify({ ipAddress: item.ipAddress, reason }),
    })
    await loadIps()
  }

  const unblockIp = async (id: number | null, ipAddress: string) => {
    if (!id) return
    if (!window.confirm(`确定解除 ${ipAddress} 的限制吗？`)) return
    await apiRequest(`/api/admin/ip-blocks/${id}`, { method: 'DELETE' })
    await loadIps()
  }

  if (authenticated === null) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">正在连接后台…</div>
  }

  if (!authenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-950">
        <form onSubmit={login} className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-6 shadow-xl dark:border-white/[0.1] dark:bg-gray-900">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">GPT Image Playground</div>
          <h1 className="mt-2 text-2xl font-bold">运营后台</h1>
          <div className="mt-6 space-y-4">
            <label className="block text-sm">管理员账号<input value={username} onChange={(e) => setUsername(e.target.value)} className={`${fieldClass()} mt-1.5`} autoComplete="username" /></label>
            <label className="block text-sm">密码<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className={`${fieldClass()} mt-1.5`} autoComplete="current-password" /></label>
          </div>
          {error && <div className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
          <button type="submit" className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">登录</button>
          <a href="/" className="mt-4 block text-center text-xs text-gray-500 hover:text-gray-700">返回图片生成页面</a>
        </form>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="border-b border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <div><div className="font-bold">运营后台</div><div className="text-xs text-gray-500">img2.blackengine.top</div></div>
          <div className="flex items-center gap-3 text-sm"><span className="text-gray-500">{username}</span><button type="button" onClick={() => void logout()} className="rounded-lg border border-gray-200 px-3 py-1.5 hover:bg-gray-50 dark:border-white/[0.1] dark:hover:bg-white/[0.06]">退出</button></div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {ADMIN_NAV_GROUPS.map((group) => <div key={group.label} className="contents lg:flex lg:flex-col lg:gap-1">
            <div className="hidden px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 first:pt-0 lg:block">{group.label}</div>
            {group.items.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={`w-full whitespace-nowrap rounded-xl px-4 py-2.5 text-left text-sm font-medium ${tab === value ? 'bg-blue-600 text-white' : 'bg-white hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-white/[0.06]'}`}>{label}</button>
            ))}
          </div>)}
          <a href="/" className="rounded-xl px-4 py-2.5 text-sm text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]">返回前台</a>
        </nav>

        <main className="min-w-0">
          {error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-300">{error}</div>}

          {tab === 'dashboard' && summary && (
            <section>
              <div className="mb-5"><h1 className="text-2xl font-bold">最近 30 天总览</h1><p className="mt-1 text-sm text-gray-500">统计访问、生图用量、请求尺寸和真实 IP；保存提示词审计记录，但不保存图片。</p></div>
              <div className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-gray-900">
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${liveQueue?.active.length ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`} /><h2 className="font-bold">实时运行状态</h2></div><p className="mt-1 text-xs text-gray-500">查看正在生成和排队中的真实 IP，请进入实时任务。</p></div>
                <div className="flex gap-6 text-sm"><div><span className="text-gray-500">生成中</span><strong className="ml-2 text-xl">{liveQueue?.active.length ?? 0}</strong></div><div><span className="text-gray-500">排队</span><strong className="ml-2 text-xl">{liveQueue?.waiting.length ?? 0}</strong></div><div><span className="text-gray-500">并发上限</span><strong className="ml-2 text-xl">{liveQueue?.concurrency ?? 4}</strong></div></div>
                <button type="button" onClick={() => setTab('live')} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-white/[0.1] dark:hover:bg-white/[0.06]">查看实时任务</button>
                {!!liveQueue?.active.length && <div className="w-full border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-white/[0.06]">正在生成 IP：{liveQueue.active.map((item) => item.ipAddress).join('、')}</div>}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  ['独立 IP', summary.uniqueIps], ['访问次数', summary.visits], ['生图请求', summary.requests],
                  ['生成图片', summary.images], ['成功请求', summary.successful], ['失败请求', summary.failed],
                  ['平均耗时（含排队）', formatDuration(summary.averageDurationMs)], ['日均生图请求', Math.round(summary.requests / 30 * 10) / 10], ['单日峰值', Math.max(0, ...dailyTrend.map((item) => item.requests))],
                ].map(([label, value]) => <div key={label} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-gray-900"><div className="text-sm text-gray-500">{label}</div><div className="mt-2 text-3xl font-bold">{value}</div></div>)}
              </div>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {(['gpt', 'sensenova-u1'] as const).map((module) => {
                  const item = summary.modules.find((value) => value.module === module)
                  return <div key={module} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-gray-900"><div className="flex items-center justify-between"><h2 className="font-bold">{module === 'sensenova-u1' ? 'U1 信息图' : 'GPT 生图'}</h2><span className="rounded-full bg-blue-50 px-2 py-1 text-xs text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">独立统计</span></div><div className="mt-4 grid grid-cols-3 gap-3 text-sm"><div><div className="text-gray-500">请求</div><strong className="mt-1 block text-xl">{item?.requests ?? 0}</strong></div><div><div className="text-gray-500">图片</div><strong className="mt-1 block text-xl">{item?.images ?? 0}</strong></div><div><div className="text-gray-500">平均耗时</div><strong className="mt-1 block text-base">{formatDuration(item?.averageDurationMs ?? null)}</strong></div></div></div>
                })}
              </div>

              <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
                <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-gray-900">
                  <div className="flex items-center justify-between"><div><h2 className="font-bold">每日使用趋势</h2><p className="mt-1 text-xs text-gray-500">蓝色为访问次数，紫色为生图请求</p></div><div className="flex gap-3 text-xs"><span className="text-blue-600">● 访问</span><span className="text-violet-600">● 生图</span></div></div>
                  <div className="mt-6 flex h-56 items-end gap-1 overflow-x-auto border-b border-gray-200 pb-1 dark:border-white/[0.08]">
                    {dailyTrend.map((item) => {
                      const max = Math.max(1, ...dailyTrend.flatMap((day) => [day.visits, day.requests]))
                      return <div key={item.date} title={`${item.date}\n访问 ${item.visits}\n生图请求 ${item.requests}\n图片 ${item.images}\n成功 ${item.successful}\n失败 ${item.failed}`} className="flex h-full min-w-5 flex-1 items-end justify-center gap-0.5"><div className="w-2 rounded-t bg-blue-400" style={{ height: `${Math.max(item.visits ? 4 : 0, item.visits / max * 100)}%` }} /><div className="w-2 rounded-t bg-violet-500" style={{ height: `${Math.max(item.requests ? 4 : 0, item.requests / max * 100)}%` }} /></div>
                    })}
                    {!dailyTrend.length && <div className="m-auto text-sm text-gray-500">暂无趋势数据</div>}
                  </div>
                  {dailyTrend.length > 0 && <div className="mt-2 flex justify-between text-[11px] text-gray-400"><span>{dailyTrend[0].date}</span><span>{dailyTrend[dailyTrend.length - 1].date}</span></div>}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-gray-900">
                  <h2 className="font-bold">请求分辨率</h2><p className="mt-1 text-xs text-gray-500">按请求长边归类：1K、2K、4K</p>
                  <div className="mt-5 space-y-4">
                    {['1K', '2K', '4K', 'other'].map((tier) => {
                      const item = summary.resolutions.find((resolution) => resolution.tier === tier)
                      const requests = item?.requests ?? 0
                      return <div key={tier}><div className="mb-1.5 flex justify-between text-sm"><span>{tier === 'other' ? '其他' : tier}</span><span className="text-gray-500">{requests} 次 · {item?.images ?? 0} 张</span></div><div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]"><div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500" style={{ width: `${summary.requests ? requests / summary.requests * 100 : 0}%` }} /></div></div>
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-gray-900">
                <h2 className="font-bold">热门关键词</h2><p className="mt-1 text-xs text-gray-500">按最近 30 天内包含该词的生成请求数统计；点击关键词查看对应记录。</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {topKeywords.map((item, idx) => <button key={item.keyword} type="button" onClick={() => { setGenerationQuery(item.keyword); setGenerationIp(''); setGenerationDateFrom(''); setGenerationDateTo(''); setTab('generations') }} className="group rounded-xl border border-gray-100 p-3 text-left hover:border-blue-300 hover:bg-blue-50/50 dark:border-white/[0.06] dark:hover:border-blue-500/40 dark:hover:bg-blue-500/[0.06]"><div className="flex items-center justify-between gap-2"><span className="truncate font-medium"><span className="mr-2 text-xs text-gray-400">#{idx + 1}</span>{item.keyword}</span><span className="shrink-0 text-xs text-gray-500">{item.count} 次</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-white/[0.06]"><div className="h-full rounded-full bg-blue-500" style={{ width: `${topKeywords[0]?.count ? item.count / topKeywords[0].count * 100 : 0}%` }} /></div><div className="mt-1.5 text-[11px] text-gray-400">覆盖 {item.percentage}% 请求</div></button>)}
                  {!topKeywords.length && <div className="col-span-full py-6 text-center text-sm text-gray-500">暂无提示词统计</div>}
                </div>
              </div>
            </section>
          )}

          {tab === 'live' && (
            <section>
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">实时任务</h1><p className="mt-1 text-sm text-gray-500">每 2 秒更新，显示正在生成和排队请求的真实 IP，不展示或保存图片。</p></div><div className="flex gap-2 text-sm"><span className="rounded-xl bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">生成中 {liveQueue?.active.length ?? 0}</span><span className="rounded-xl bg-gray-100 px-3 py-2 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">排队 {liveQueue?.waiting.length ?? 0}</span><span className="rounded-xl bg-blue-500/10 px-3 py-2 text-blue-700 dark:text-blue-300">并发 {liveQueue?.concurrency ?? 4}</span></div></div>
              <div className="space-y-6">
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-gray-500">正在生成</h2>
                  <div className="space-y-3">
                    {liveQueue?.active.map((item) => <article key={item.requestId} className="rounded-2xl border border-amber-300/50 bg-amber-50/50 p-4 dark:border-amber-500/20 dark:bg-amber-500/[0.05]"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-amber-500 px-2 py-1 font-medium text-white">生成中</span><span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{item.module === 'sensenova-u1' ? 'U1 信息图' : 'GPT 生图'}</span><span className="font-mono font-semibold text-gray-800 dark:text-gray-100">{item.ipAddress}</span><span className="text-gray-400">已运行 {formatDuration(item.runtimeMs ?? 0)}</span><span className="text-gray-400">等待过 {formatDuration(item.waitMs)}</span></div><div data-selectable-text className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-white/70 px-4 py-3 text-sm dark:bg-white/[0.04]">{item.prompt || '未记录到提示词'}</div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500"><span>{item.action === 'edit' ? '编辑图片' : '生成图片'}</span><span>尺寸：{item.size || '—'}</span><span>数量：{item.imageCount}</span><span>开始：{localDate(item.startedAt ?? null)}</span><span className="font-mono">ID：{item.requestId}</span></div></article>)}
                    {!liveQueue?.active.length && <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-500 dark:border-white/[0.08] dark:bg-gray-900">当前没有正在生成的任务</div>}
                  </div>
                </div>
                <div>
                  <h2 className="mb-3 text-sm font-semibold text-gray-500">等待队列</h2>
                  <div className="space-y-3">
                    {liveQueue?.waiting.map((item) => <article key={item.requestId} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-900"><div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-600 dark:bg-white/[0.06] dark:text-gray-300">排队第 {item.position} 位</span><span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{item.module === 'sensenova-u1' ? 'U1 信息图' : 'GPT 生图'}</span><span className="font-mono font-semibold text-gray-800 dark:text-gray-100">{item.ipAddress}</span><span className="text-gray-400">已等待 {formatDuration(item.waitMs)}</span></div><div data-selectable-text className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-gray-50 px-4 py-3 text-sm dark:bg-white/[0.04]">{item.prompt || '未记录到提示词'}</div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500"><span>{item.action === 'edit' ? '编辑图片' : '生成图片'}</span><span>尺寸：{item.size || '—'}</span><span>数量：{item.imageCount}</span><span>进入队列：{localDate(item.queuedAt)}</span><span className="font-mono">ID：{item.requestId}</span></div></article>)}
                    {!liveQueue?.waiting.length && <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-5 py-8 text-center text-sm text-gray-500 dark:border-white/[0.08] dark:bg-gray-900">当前没有排队任务</div>}
                  </div>
                </div>
              </div>
            </section>
          )}

          {tab === 'settings' && (
            <section>
              <div className="mb-5"><h1 className="text-2xl font-bold">系统设置</h1><p className="mt-1 text-sm text-gray-500">集中管理生成并发、IP 使用限制和首页公开提示，修改后立即生效。</p></div>
              <form onSubmit={saveQueueSettings} className="mb-5 flex flex-wrap items-end gap-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-gray-900">
                <div className="min-w-[260px] flex-1"><h2 className="font-bold">全站生成队列</h2><p className="mt-1 text-xs text-gray-500">同一 IP 达到上限后不会继续占用全站并发，其他 IP 可优先获得空闲位置。</p></div>
                <div className="flex flex-wrap items-end gap-2"><label className="text-sm">全站同时生成<input type="number" min="1" max="20" value={queueConcurrency} onChange={(e) => setQueueConcurrency(e.target.value)} className={`${fieldClass()} mt-1 w-28`} /></label><label className="text-sm">单 IP 同时生成<input type="number" min="1" max="20" value={perIpConcurrency} onChange={(e) => setPerIpConcurrency(e.target.value)} className={`${fieldClass()} mt-1 w-28`} /></label><label className="text-sm">单 IP 最多排队<input type="number" min="0" max="100" value={perIpQueueLimit} onChange={(e) => setPerIpQueueLimit(e.target.value)} className={`${fieldClass()} mt-1 w-28`} /></label><button type="submit" className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">保存</button></div>
                {queueSettings && <div className="w-full text-xs text-gray-500">当前：生成中 {queueSettings.active} · 排队 {queueSettings.waiting} · 全站并发 {queueSettings.concurrency} · 单 IP 并发 {queueSettings.perIpConcurrency} · 单 IP 排队 {queueSettings.perIpQueueLimit}</div>}
                <div className="w-full border-t border-gray-100 pt-4 dark:border-white/[0.06]"><div className="mb-3 flex flex-wrap items-center gap-2"><h3 className="font-semibold">U1 信息图独立队列</h3><span className={`rounded-full px-2 py-0.5 text-xs ${queueSettings?.senseNovaConfigured ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>{queueSettings?.senseNovaConfigured ? 'API 已配置' : 'API Key 未配置'}</span></div><div className="flex flex-wrap items-end gap-2"><label className="text-sm">U1 全站同时生成<input type="number" min="1" max="20" value={senseNovaConcurrencyInput} onChange={(e) => setSenseNovaConcurrencyInput(e.target.value)} className={`${fieldClass()} mt-1 w-32`} /></label><label className="text-sm">U1 单 IP 同时生成<input type="number" min="1" max="20" value={senseNovaPerIpConcurrencyInput} onChange={(e) => setSenseNovaPerIpConcurrencyInput(e.target.value)} className={`${fieldClass()} mt-1 w-32`} /></label><label className="text-sm">U1 单 IP 最多排队<input type="number" min="0" max="100" value={senseNovaPerIpQueueLimitInput} onChange={(e) => setSenseNovaPerIpQueueLimitInput(e.target.value)} className={`${fieldClass()} mt-1 w-32`} /></label></div>{queueSettings && <div className="mt-3 text-xs text-gray-500">U1 当前：生成中 {queueSettings.senseNovaActive} · 排队 {queueSettings.senseNovaWaiting}</div>}</div>
              </form>
              {siteSettings && <form onSubmit={saveSiteSettings} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-gray-900"><div><h2 className="font-bold">首页顶部提示</h2><p className="mt-1 text-xs text-gray-500">控制首页标题旁的本地存储提示和生图队列状态。</p></div><div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]"><label className="text-sm">本地存储提示文字<input value={siteSettings.privacyNoticeText} onChange={(e) => setSiteSettings({ ...siteSettings, privacyNoticeText: e.target.value })} maxLength={200} className={`${fieldClass()} mt-1`} /></label><div className="flex flex-wrap items-center gap-4 rounded-xl bg-gray-50 px-4 py-2 dark:bg-white/[0.04]"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={siteSettings.privacyNoticeEnabled} onChange={(e) => setSiteSettings({ ...siteSettings, privacyNoticeEnabled: e.target.checked })} />显示本地存储提示</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={siteSettings.queueStatusEnabled} onChange={(e) => setSiteSettings({ ...siteSettings, queueStatusEnabled: e.target.checked })} />显示生图队列状态</label></div></div><div className="mt-4 flex items-center justify-between gap-3"><span className="text-xs text-gray-400">最多 200 个字符，前台约 5 秒内同步。</span><button type="submit" className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">保存提示设置</button></div></form>}
            </section>
          )}

          {tab === 'generations' && (
            <section>
              <div className="mb-4"><h1 className="text-2xl font-bold">生成记录</h1><p className="mt-1 text-sm text-gray-500">查看提示词和请求参数，不保存生成图片。</p></div>
              <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-900">
                <label className="text-sm">文字搜索<input value={generationQuery} onChange={(e) => setGenerationQuery(e.target.value)} className={`${fieldClass()} mt-1 w-64`} placeholder="提示词、模型或请求 ID" /></label>
                <label className="text-sm">IP 地址<input value={generationIp} onChange={(e) => setGenerationIp(e.target.value)} className={`${fieldClass()} mt-1 w-44 font-mono`} placeholder="留空显示全部" /></label>
                <label className="text-sm">生图模块<select value={generationModule} onChange={(e) => setGenerationModule(e.target.value)} className={`${fieldClass()} mt-1 w-40`}><option value="">全部模块</option><option value="gpt">GPT 生图</option><option value="sensenova-u1">U1 信息图</option></select></label>
                <label className="text-sm">开始日期<input type="date" value={generationDateFrom} onChange={(e) => setGenerationDateFrom(e.target.value)} className={`${fieldClass()} mt-1 w-40`} /></label>
                <label className="text-sm">结束日期<input type="date" value={generationDateTo} onChange={(e) => setGenerationDateTo(e.target.value)} className={`${fieldClass()} mt-1 w-40`} /></label>
                <button type="button" onClick={() => { setGenerationQuery(''); setGenerationIp(''); setGenerationDateFrom(''); setGenerationDateTo(''); setGenerationModule('') }} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm hover:bg-gray-50 dark:border-white/[0.1] dark:hover:bg-white/[0.06]">清空筛选</button>
              </div>
              <div className="space-y-3">
                {generations.map((item) => (
                  <article key={item.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-900">
                    <div className="flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full px-2 py-1 font-medium ${item.action === 'edit' ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' : 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'}`}>{item.action === 'edit' ? '编辑图片' : '生成图片'}</span><span className="rounded-full bg-violet-50 px-2 py-1 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300">{item.module === 'sensenova-u1' ? 'U1 信息图' : 'GPT 生图'}</span><span className={`rounded-full px-2 py-1 ${item.status === 'success' ? 'bg-green-50 text-green-700 dark:bg-green-500/10' : item.status === 'failed' ? 'bg-red-50 text-red-600 dark:bg-red-500/10' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06]'}`}>{item.status === 'success' ? '成功' : item.status === 'failed' ? '失败' : '处理中'}</span><span className="font-mono text-gray-500">{item.ipAddress || '未知 IP'}</span><span className="text-gray-400">{localDate(item.createdAt)}</span></div>
                    <div data-selectable-text className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-gray-50 px-4 py-3 text-sm leading-6 text-gray-700 dark:bg-white/[0.04] dark:text-gray-200">{item.prompt || '未记录到提示词'}</div>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-500"><span>模型：{item.model || '—'}</span><span>尺寸：{item.size || '—'}（{item.resolutionTier === 'other' ? '其他' : item.resolutionTier}）</span><span>质量：{item.quality || '—'}</span><span>数量：{item.imageCount}</span><span>耗时：{formatDuration(item.durationMs)}</span><span className="font-mono">ID：{item.requestId}</span></div>
                  </article>
                ))}
                {!generations.length && <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">暂无生成记录；新请求会从本次更新后开始记录提示词。</div>}
              </div>
            </section>
          )}

          {tab === 'announcements' && (
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div>
                <div className="mb-4 flex items-center justify-between"><div><h1 className="text-2xl font-bold">公告管理</h1><p className="mt-1 text-sm text-gray-500">支持弹窗、仅一次和可关闭的置顶悬浮横条。</p></div><button type="button" onClick={startCreate} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">新建公告</button></div>
                <div className="space-y-3">
                  {announcements.map((item) => (
                    <article key={item.id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/[0.08] dark:bg-gray-900">
                      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{item.showBar || item.pinned ? '📌 ' : ''}{item.title}</h2><span className={`rounded-full px-2 py-0.5 text-[11px] ${item.status === 'published' ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06]'}`}>{item.status === 'published' ? '已发布' : item.status === 'offline' ? '已下线' : '草稿'}</span><span className="text-xs text-gray-400">v{item.version}</span></div><p className="mt-2 line-clamp-2 text-sm text-gray-500">{item.content || '无正文'}</p><div className="mt-2 text-xs text-gray-400">{item.showPopup ? '弹窗 ' : ''}{item.popupOnce ? '仅一次 ' : ''}{item.showBar || item.pinned ? '置顶悬浮横条 ' : ''}· 更新于 {localDate(item.updatedAt)}</div></div></div>
                      <div className="mt-4 flex flex-wrap gap-2 text-xs"><button type="button" onClick={() => startEdit(item)} className="rounded-lg border px-3 py-1.5 dark:border-white/[0.1]">编辑</button>{item.status === 'published' ? <button type="button" onClick={() => void announcementAction(item, 'unpublish')} className="rounded-lg border px-3 py-1.5 dark:border-white/[0.1]">下线</button> : <button type="button" onClick={() => void announcementAction(item, 'publish')} className="rounded-lg bg-green-600 px-3 py-1.5 text-white">发布</button>}<button type="button" onClick={() => void announcementAction(item, 'republish')} className="rounded-lg bg-blue-50 px-3 py-1.5 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">重新推送</button><button type="button" onClick={() => void announcementAction(item, 'delete')} className="rounded-lg bg-red-50 px-3 py-1.5 text-red-600 dark:bg-red-500/10">删除</button></div>
                    </article>
                  ))}
                  {!announcements.length && <div className="rounded-2xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-500">还没有公告</div>}
                </div>
              </div>

              <form onSubmit={saveAnnouncement} className="h-fit rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/[0.08] dark:bg-gray-900">
                <h2 className="font-bold">{editing ? `编辑公告 #${editing.id}` : '新建公告'}</h2>
                <div className="mt-4 space-y-4">
                  <label className="block text-sm">标题<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={`${fieldClass()} mt-1.5`} /></label>
                  <label className="block text-sm">正文<textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} rows={5} className={`${fieldClass()} mt-1.5 resize-y`} /></label>
                  <div className="grid grid-cols-2 gap-3"><label className="block text-sm">链接<input value={draft.linkUrl} onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })} className={`${fieldClass()} mt-1.5`} placeholder="https://…" /></label><label className="block text-sm">按钮文字<input value={draft.linkLabel} onChange={(e) => setDraft({ ...draft, linkLabel: e.target.value })} className={`${fieldClass()} mt-1.5`} /></label></div>
                  <div className="grid grid-cols-2 gap-3"><label className="block text-sm">开始时间<input type="datetime-local" value={toDateInput(draft.startsAt)} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value || null })} className={`${fieldClass()} mt-1.5`} /></label><label className="block text-sm">结束时间<input type="datetime-local" value={toDateInput(draft.endsAt)} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value || null })} className={`${fieldClass()} mt-1.5`} /></label></div>
                  <label className="block text-sm">优先级<input type="number" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} className={`${fieldClass()} mt-1.5`} /></label>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {[
                      ['showPopup', '弹窗'], ['popupOnce', '仅弹一次'],
                      ['showBar', '置顶悬浮横条'], ['dismissible', '允许关闭'],
                    ].map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-white/[0.04]"><input type="checkbox" checked={Boolean(draft[key as keyof AnnouncementDraft])} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />{label}</label>)}
                  </div>
                </div>
                <button type="submit" className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">保存公告</button>
              </form>
            </section>
          )}

          {tab === 'ips' && (
            <section>
              <div className="mb-5"><h1 className="text-2xl font-bold">IP 管理</h1><p className="mt-1 text-sm text-gray-500">显示最近 30 天的真实客户端 IP 和用量；拉黑后会在请求上游 API 前直接拒绝生图。</p></div>
              <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.03]"><tr>{['IP 地址', '访问', '生图请求', '图片数', '成功 / 失败', '最后活动', '操作'].map((item) => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">
                    {ipUsage.map((item) => (
                      <tr key={item.ipAddress}>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{item.ipAddress}</td>
                        <td className="px-4 py-3">{item.visits}</td>
                        <td className="px-4 py-3">{item.requests}</td>
                        <td className="px-4 py-3">{item.images}</td>
                        <td className="whitespace-nowrap px-4 py-3"><span className="text-green-600">{item.successful}</span> / <span className="text-red-500">{item.failed}</span></td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{localDate(item.lastSeenAt)}</td>
                        <td className="px-4 py-3">{item.blockId ? <button type="button" onClick={() => void unblockIp(item.blockId, item.ipAddress)} className="rounded-lg bg-green-50 px-3 py-1.5 text-xs text-green-700 dark:bg-green-500/10 dark:text-green-300">解除拉黑</button> : <button type="button" onClick={() => void blockIp(item)} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-600 dark:bg-red-500/10">拉黑</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!ipUsage.length && <div className="p-10 text-center text-sm text-gray-500">暂无 IP 活动数据</div>}
              </div>

              <div className="mt-6">
                <h2 className="mb-3 font-bold">封禁记录</h2>
                <div className="space-y-2">
                  {ipBlocks.map((block) => <div key={block.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm dark:border-white/[0.08] dark:bg-gray-900"><span className="font-mono text-xs">{block.ipAddress}</span><span className={`rounded-full px-2 py-0.5 text-xs ${block.active ? 'bg-red-50 text-red-600 dark:bg-red-500/10' : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06]'}`}>{block.active ? '生效中' : '已过期'}</span><span className="min-w-0 flex-1 text-gray-500">{block.reason || '未填写原因'}</span><span className="text-xs text-gray-400">{localDate(block.createdAt)}</span><button type="button" onClick={() => void unblockIp(block.id, block.ipAddress)} className="rounded-lg border px-3 py-1.5 text-xs dark:border-white/[0.1]">删除记录</button></div>)}
                  {!ipBlocks.length && <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">暂无封禁记录</div>}
                </div>
              </div>
            </section>
          )}

          {tab === 'logs' && (
            <section>
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-bold">日志中心</h1><p className="mt-1 text-sm text-gray-500">日志不记录 Key、提示词或图片；真实 IP 仅在“IP 管理”中展示。</p></div><label className="text-sm">类型<select value={logType} onChange={(e) => setLogType(e.target.value)} className={`${fieldClass()} mt-1 w-40`}><option value="">全部</option><option value="admin">管理操作</option><option value="request">图片请求</option><option value="system">系统错误</option><option value="security">安全事件</option></select></label></div>
              <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-gray-900"><table className="min-w-full text-left text-sm"><thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.03]"><tr>{['时间', '级别', '类型', '事件', '状态', '耗时', '请求 ID'].map((item) => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead><tbody className="divide-y divide-gray-100 dark:divide-white/[0.06]">{logs.map((item) => <tr key={item.id}><td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{localDate(item.createdAt)}</td><td className="px-4 py-3">{item.level}</td><td className="px-4 py-3">{item.type}</td><td className="px-4 py-3 font-mono text-xs">{item.event}</td><td className="px-4 py-3">{item.status || '—'}</td><td className="px-4 py-3">{formatDuration(item.durationMs)}</td><td className="max-w-[160px] truncate px-4 py-3 font-mono text-xs text-gray-500" title={item.requestId}>{item.requestId || '—'}</td></tr>)}</tbody></table>{!logs.length && <div className="p-10 text-center text-sm text-gray-500">暂无日志</div>}</div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
