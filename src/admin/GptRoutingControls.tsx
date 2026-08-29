import type { ReactNode } from 'react'

export type GptChannel = 'primary' | 'sixoner' | 'catapi'
export type GptAction = 'generate' | 'edit'
export type GptTier = '2K' | '4K'
export type GptRoutes = Record<GptAction, Record<GptTier, GptChannel[]>>

export type RoutingSettings = {
  streamEnabled: boolean
  autoFallbackOnMismatch: boolean
  gptRoutes: GptRoutes
  recommendedStreamEnabled: boolean
  recommendedAutoFallbackOnMismatch: boolean
  recommendedGptRoutes: GptRoutes
  configured: Record<GptChannel, boolean>
}
type GptRoutingControlsProps = {
  settings: RoutingSettings
  onChange: (settings: RoutingSettings) => void
  onReset: () => void
  resetPending?: boolean
}

const CHANNEL_META: Record<GptChannel, { name: string; description: string }> = {
  sixoner: { name: 'Sixoner', description: '当前质量优先推荐线路' },
  catapi: { name: 'CatAPI', description: '可作为 2K/4K 备用线路' },
  primary: { name: 'BlackEngine', description: '本站主线路，可作为备用或首选' },
}

const ROUTE_GROUPS: Array<{ action: GptAction; tier: GptTier; label: string; model: string }> = [
  { action: 'generate', tier: '2K', label: '无图生成 2K', model: 'gpt-image-2-2k' },
  { action: 'generate', tier: '4K', label: '无图生成 4K', model: 'gpt-image-2-4k' },
  { action: 'edit', tier: '2K', label: '有图编辑 2K', model: 'gpt-image-2-2k' },
  { action: 'edit', tier: '4K', label: '有图编辑 4K', model: 'gpt-image-2-4k' },
]

function moveRoute(settings: RoutingSettings, action: GptAction, tier: GptTier, index: number, offset: -1 | 1) {
  const routes = settings.gptRoutes[action][tier]
  const nextIndex = index + offset
  if (nextIndex < 0 || nextIndex >= routes.length) return null
  const nextRoutes = [...routes]
  const [item] = nextRoutes.splice(index, 1)
  if (!item) return null
  nextRoutes.splice(nextIndex, 0, item)
  return {
    ...settings,
    gptRoutes: {
      ...settings.gptRoutes,
      [action]: { ...settings.gptRoutes[action], [tier]: nextRoutes },
    },
  }
}

function RouteList({
  action,
  tier,
  label,
  model,
  routes,
  configured,
  onMove,
}: {
  action: GptAction
  tier: GptTier
  label: string
  model: string
  routes: GptChannel[]
  configured: Record<GptChannel, boolean>
  onMove: (index: number, offset: -1 | 1) => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-white/[0.08]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/70 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.025]">
        <div>
          <h4 className="text-sm font-semibold">{label}</h4>
          <code className="text-[11px] text-gray-400">{model}</code>
        </div>
        <span className="text-[11px] text-gray-400">上方优先，失败后回退</span>
      </div>
      <ol className="divide-y divide-gray-100 dark:divide-white/[0.06]">
        {routes.map((channel, index) => {
          const meta = CHANNEL_META[channel]
          const available = configured[channel]
          return (
            <li key={`${action}-${tier}-${channel}`} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-bold text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{meta.name}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${available ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300' : 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'}`}>
                    {available ? '已配置' : '未配置，将跳过'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-gray-500">{meta.description}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button type="button" aria-label={`${label} ${meta.name} 上移`} disabled={index === 0} onClick={() => onMove(index, -1)} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.06]">上移</button>
                <button type="button" aria-label={`${label} ${meta.name} 下移`} disabled={index === routes.length - 1} onClick={() => onMove(index, 1)} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-30 dark:border-white/[0.1] dark:text-gray-300 dark:hover:bg-white/[0.06]">下移</button>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function ToggleRow({ checked, onChange, children }: { checked: boolean; onChange: () => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-gray-200 px-4 py-3 transition hover:border-gray-300 dark:border-white/[0.1] dark:hover:border-white/[0.18]">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 accent-blue-600" />
      <span className="text-sm leading-5">{children}</span>
    </label>
  )
}

export default function GptRoutingControls({ settings, onChange, onReset, resetPending = false }: GptRoutingControlsProps) {
  const updateRoute = (action: GptAction, tier: GptTier, index: number, offset: -1 | 1) => {
    const next = moveRoute(settings, action, tier, index, offset)
    if (next) onChange(next)
  }

  return (
    <fieldset>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <legend className="font-semibold">GPT 生图路由与流式策略</legend>
          <p className="mt-1 text-xs leading-5 text-gray-500">生成和编辑分别使用四组 2K/4K 顺序。保存后新请求和等待中的请求使用新设置，已经发往上游的请求不会中断。</p>
        </div>
        <button type="button" onClick={onReset} disabled={resetPending} className="rounded-xl border border-amber-200 px-3 py-2 text-xs font-medium text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-500/20 dark:text-amber-300 dark:hover:bg-amber-500/10">
          {resetPending ? '正在恢复…' : '恢复推荐设置'}
        </button>
      </div>

      <div className="mt-5 rounded-xl border border-gray-200 p-4 dark:border-white/[0.08]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">全站流式后台开关</h3>
            <p className="mt-1 text-xs leading-5 text-gray-500">开启时允许前台按请求使用流式；关闭时强制所有 GPT 请求使用完整 JSON 响应。</p>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${settings.streamEnabled ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-300'}`}>
            {settings.streamEnabled ? '当前开启' : '当前关闭'}
          </span>
        </div>
        <div className="mt-3">
          <ToggleRow checked={settings.streamEnabled} onChange={() => onChange({ ...settings, streamEnabled: !settings.streamEnabled })}>
            <span className="font-medium">允许流式传输</span><span className="mt-0.5 block text-xs text-gray-500">关闭后会移除 stream、partial_images 等字段</span>
          </ToggleRow>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-white/[0.08]">
        <ToggleRow checked={settings.autoFallbackOnMismatch} onChange={() => onChange({ ...settings, autoFallbackOnMismatch: !settings.autoFallbackOnMismatch })}>
          <span className="font-medium">质量/尺寸不匹配时自动回退</span><span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-300">仅检查完整 JSON 响应；可能产生额外上游费用，默认关闭</span>
        </ToggleRow>
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {ROUTE_GROUPS.map(({ action, tier, label, model }) => (
          <RouteList key={`${action}-${tier}`} action={action} tier={tier} label={label} model={model} routes={settings.gptRoutes[action][tier]} configured={settings.configured} onMove={(index, offset) => updateRoute(action, tier, index, offset)} />
        ))}
      </div>

      <div className="mt-4 rounded-xl bg-blue-50 px-4 py-3 text-xs leading-5 text-blue-800 dark:bg-blue-500/[0.08] dark:text-blue-200">
        <span className="font-semibold">推荐默认：</span>
        四组均为 {ROUTE_GROUPS.length > 0 ? settings.recommendedGptRoutes.generate['2K'].map((channel) => CHANNEL_META[channel].name).join(' → ') : ''}；流式开启，自动不匹配回退关闭。恢复推荐设置不会修改并发、IP 限制或首页设置。
      </div>
    </fieldset>
  )
}
