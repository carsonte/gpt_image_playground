import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Announcement } from '../lib/announcementApi'
import { apiRequest } from '../lib/announcementApi'

function stateKey(item: Announcement, type: 'popup-seen' | 'bar-dismissed') {
  return `announcement:${item.id}:${item.version}:${type}`
}

function hasState(item: Announcement, type: 'popup-seen' | 'bar-dismissed') {
  try {
    return window.localStorage.getItem(stateKey(item, type)) === '1'
  } catch {
    return false
  }
}

function saveState(item: Announcement, type: 'popup-seen' | 'bar-dismissed') {
  try {
    window.localStorage.setItem(stateKey(item, type), '1')
  } catch {
    // localStorage 不可用时只影响去重，不影响公告展示。
  }
}

export default function AnnouncementCenter() {
  const [items, setItems] = useState<Announcement[]>([])
  const [popup, setPopup] = useState<Announcement | null>(null)
  const [dismissedBars, setDismissedBars] = useState<Set<number>>(new Set())

  useEffect(() => {
    void apiRequest<{ announcements: Announcement[] }>('/api/announcements')
      .then((result) => {
        setItems(result.announcements)
        const nextPopup = result.announcements.find((item) => item.showPopup && (!item.popupOnce || !hasState(item, 'popup-seen')))
        if (nextPopup) setPopup(nextPopup)
      })
      .catch((error) => console.warn('公告加载失败：', error))

    void fetch('/api/visits', { method: 'POST', credentials: 'same-origin' })
      .catch((error) => console.warn('访问统计上报失败：', error))
  }, [])

  const closePopup = () => {
    if (popup?.popupOnce) saveState(popup, 'popup-seen')
    setPopup(null)
  }

  const closeBar = (item: Announcement) => {
    saveState(item, 'bar-dismissed')
    setDismissedBars((current) => new Set(current).add(item.id))
  }

  const bars = items.filter((item) => (item.showBar || item.pinned) && !dismissedBars.has(item.id) && !hasState(item, 'bar-dismissed'))
  const bar = bars[0]

  return (
    <>
      {bar && (
        <div className="mt-3 -mb-3 flex min-w-0 items-center">
          <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl border border-blue-400/30 bg-blue-600 px-3 text-sm text-white shadow-sm shadow-blue-900/10">
            <span className="min-w-0 flex-1 truncate font-medium" title={`${bar.title}${bar.content ? ` · ${bar.content}` : ''}`}>
              {bar.title}{bar.content ? ` · ${bar.content}` : ''}
            </span>
            {bars.length > 1 && <span className="shrink-0 text-xs text-white/75">+{bars.length - 1}</span>}
            {bar.linkUrl && (
              <a href={bar.linkUrl} target={bar.linkUrl.startsWith('/') ? undefined : '_blank'} rel="noreferrer" className="shrink-0 rounded-lg bg-white/15 px-2 py-1 text-xs font-semibold hover:bg-white/25">
                {bar.linkLabel || '查看详情'}
              </a>
            )}
            {bar.dismissible && <button type="button" onClick={() => closeBar(bar)} className="shrink-0 rounded-lg border border-white/30 bg-white/10 px-3 py-1 text-xs font-semibold text-white hover:border-white/50 hover:bg-white/20" aria-label="关闭公告">关闭</button>}
          </div>
        </div>
      )}

      {popup && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="announcement-title">
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-2xl dark:border-white/[0.1] dark:bg-gray-900">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-xl dark:bg-blue-500/10">📣</div>
              <div className="min-w-0 flex-1">
                <h2 id="announcement-title" className="text-lg font-bold text-gray-900 dark:text-gray-100">{popup.title}</h2>
                {popup.content && <div data-selectable-text className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-600 dark:text-gray-300">{popup.content}</div>}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              {popup.linkUrl && (
                <a href={popup.linkUrl} target={popup.linkUrl.startsWith('/') ? undefined : '_blank'} rel="noreferrer" className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                  {popup.linkLabel || '查看详情'}
                </a>
              )}
              {popup.dismissible && <button type="button" onClick={closePopup} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-white/[0.1] dark:text-gray-200 dark:hover:bg-white/[0.06]">关闭</button>}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
