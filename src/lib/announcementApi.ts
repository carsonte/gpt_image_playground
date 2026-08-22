export type Announcement = {
  id: number
  title: string
  content: string
  linkUrl: string
  linkLabel: string
  status: 'draft' | 'published' | 'offline'
  showPopup: boolean
  popupOnce: boolean
  pinned: boolean
  showBar: boolean
  dismissible: boolean
  priority: number
  startsAt: string | null
  endsAt: string | null
  version: number
  createdAt: string
  updatedAt: string
}

export type AnnouncementDraft = Omit<Announcement, 'id' | 'version' | 'createdAt' | 'updatedAt'>

export const EMPTY_ANNOUNCEMENT: AnnouncementDraft = {
  title: '',
  content: '',
  linkUrl: '',
  linkLabel: '',
  status: 'draft',
  showPopup: true,
  popupOnce: true,
  pinned: false,
  showBar: false,
  dismissible: true,
  priority: 0,
  startsAt: null,
  endsAt: null,
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : `请求失败：HTTP ${response.status}`)
  return payload as T
}
