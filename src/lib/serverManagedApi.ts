import { readRuntimeEnv } from './runtimeEnv'

export function isServerManagedApi() {
  return readRuntimeEnv(import.meta.env.VITE_SERVER_MANAGED_API) === 'true'
}

export async function reportManagedGenerationResult(requestId: string | undefined, outputSize: string | undefined, outputQuality?: string) {
  if (!isServerManagedApi() || !requestId || (!outputSize && !outputQuality)) return
  try {
    const body = {
      requestId,
      ...(outputSize ? { outputSize } : {}),
      ...(outputQuality ? { outputQuality } : {}),
    }
    const response = await fetch('/api/generation-result', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) console.warn('回报实际输出参数失败', response.status)
  } catch (err) {
    console.warn('回报实际输出参数失败', err)
  }
}
