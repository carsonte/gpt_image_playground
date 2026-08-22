import { useEffect, useState } from 'react'
import { fetchGenerationQueueStatus, type GenerationQueueStatus as QueueStatus } from '../lib/queueApi'

export default function GenerationQueueStatus() {
  const [status, setStatus] = useState<QueueStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      void fetchGenerationQueueStatus()
        .then((next) => {
          if (!cancelled) setStatus(next)
        })
        .catch(() => {
          if (!cancelled) setStatus(null)
        })
    }
    load()
    const timer = window.setInterval(load, 2000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  if (!status) return null
  const busy = status.active > 0 || status.waiting > 0

  return (
    <span
      className={`hidden xl:inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium ${busy ? 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'border-gray-200 bg-gray-100/80 text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-gray-400'}`}
      title={`全站先进先出队列，并发上限 ${status.concurrency}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${busy ? 'animate-pulse bg-amber-500' : 'bg-emerald-500'}`} />
      {busy ? `生成中 ${status.active} · 排队 ${status.waiting}` : '生图队列空闲'}
    </span>
  )
}
