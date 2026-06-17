import { parseOrThrow } from '@shared/codec'
import type { Schema } from 'effect'

export const LOG_REFRESH_MAX_COUNT = 2000

export async function sidecarFetch<A, I>(
  op: string,
  body: Record<string, unknown>,
  schema: Schema.Schema<A, I>
): Promise<A> {
  const payload = await window.electronAPI.sidecarRequest(op, body)
  return parseOrThrow(schema, payload)
}
