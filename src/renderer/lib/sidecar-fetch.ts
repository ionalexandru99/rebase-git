import { parseOrThrow } from '@shared/codec'
import type { z } from 'zod'

export const LOG_REFRESH_MAX_COUNT = 2000

interface SidecarConfig {
  baseUrl: string
  token: string
}

let configPromise: Promise<SidecarConfig> | null = null

async function getSidecarConfig(): Promise<SidecarConfig> {
  if (!configPromise) {
    configPromise = window.electronAPI.getSidecarConfig().catch((error: unknown) => {
      configPromise = null
      throw error
    })
  }
  return configPromise
}

export async function sidecarFetch<T>(
  op: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>
): Promise<T> {
  const config = await getSidecarConfig()
  const response = await fetch(`${config.baseUrl}/op/${op}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  if (!response.ok) {
    throw new Error(`sidecar ${op} failed: HTTP ${response.status}`)
  }
  const payload: unknown = await response.json()
  return parseOrThrow(schema, payload)
}

export function resetSidecarConfigForTests(): void {
  configPromise = null
}
