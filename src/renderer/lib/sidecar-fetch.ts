import { parseOrThrow } from '@shared/codec'
import type { z } from 'zod'

export const LOG_REFRESH_MAX_COUNT = 2000

export async function sidecarFetch<T>(
  op: string,
  body: Record<string, unknown>,
  schema: z.ZodType<T>
): Promise<T> {
  const payload = await window.electronAPI.sidecarRequest(op, body)
  return parseOrThrow(schema, payload)
}
