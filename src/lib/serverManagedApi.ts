import { readRuntimeEnv } from './runtimeEnv'

export function isServerManagedApi() {
  return readRuntimeEnv(import.meta.env.VITE_SERVER_MANAGED_API) === 'true'
}

export async function reportManagedGenerationResult(requestId: string | undefined, outputSize: string | undefined) {
  if (!isServerManagedApi() || !requestId || !outputSize) return
  try {
    const response = await fetch('/api/generation-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, outputSize }),
    })
    if (!response.ok) console.warn('回报实际输出尺寸失败', response.status)
  } catch (err) {
    console.warn('回报实际输出尺寸失败', err)
  }
}
