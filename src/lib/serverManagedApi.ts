import { readRuntimeEnv } from './runtimeEnv'

export function isServerManagedApi() {
  return readRuntimeEnv(import.meta.env.VITE_SERVER_MANAGED_API) === 'true'
}
