export type GenerationQueueStatus = {
  active: number
  waiting: number
  concurrency: number
}

export async function fetchGenerationQueueStatus() {
  const response = await fetch('/api/queue/status', { cache: 'no-store' })
  if (!response.ok) throw new Error(`队列状态请求失败：HTTP ${response.status}`)
  return response.json() as Promise<GenerationQueueStatus>
}
