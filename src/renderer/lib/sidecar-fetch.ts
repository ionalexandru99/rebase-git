import { parseOrThrow } from '@shared/codec'
import type { SidecarOpName } from '@shared/sidecar-ops'
import {
  type SidecarRequest,
  type SidecarResponse,
  sidecarRegistry
} from '@shared/sidecar-registry'
import type { Schema } from 'effect'

export const LOG_REFRESH_MAX_COUNT = 2000

// Registry-driven: pass only the op and a typed body; the response schema (and type) come from
// the shared registry. The explicit-schema overload remains for the generic mutation wrappers
// whose op is one of a class of ops that all share a single response schema.
export function sidecarFetch<Op extends SidecarOpName>(
  op: Op,
  body: SidecarRequest<Op>
): Promise<SidecarResponse<Op>>
export function sidecarFetch<A, I>(
  op: string,
  body: Record<string, unknown>,
  schema: Schema.Schema<A, I>
): Promise<A>
export async function sidecarFetch(
  op: string,
  body: Record<string, unknown>,
  schema?: Schema.Schema<unknown, unknown>
): Promise<unknown> {
  const payload = await window.electronAPI.sidecarRequest(op, body)
  const responseSchema = (schema ?? sidecarRegistry[op as SidecarOpName].response) as Schema.Schema<
    unknown,
    unknown
  >
  return parseOrThrow(responseSchema, payload)
}
