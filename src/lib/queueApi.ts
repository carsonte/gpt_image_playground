export type GenerationQueueStatus = {
  active: number
  waiting: number
  concurrency: number
}

export async function fetchGenerationQueueStatus(module: 'gpt' | 'sensenova-u1') {
  const query = module === 'sensenova-u1' ? '?module=sensenova-u1' : ''
  const response = await fetch(`/api/queue/status${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`队列状态请求失败：HTTP ${response.status}`)
  return response.json() as Promise<GenerationQueueStatus>
}
