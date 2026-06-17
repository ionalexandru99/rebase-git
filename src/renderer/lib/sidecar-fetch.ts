import { parseOrThrow } from '@shared/codec'
import type { SidecarOpName } from '@shared/sidecar-ops'
import {
  getSidecarRequestSchema,
  getSidecarResponseSchema,
  type SidecarRequest,
  type SidecarResponse
} from '@shared/sidecar-registry'
import type { Schema } from 'effect'

export const LOG_REFRESH_MAX_COUNT = 2000

export async function sidecarFetch<Op extends SidecarOpName>(
  op: Op,
  body: SidecarRequest<Op>
): Promise<SidecarResponse<Op>> {
  const requestSchema = getSidecarRequestSchema(op) as unknown as Schema.Schema<
    SidecarRequest<Op>,
    unknown,
    never
  >
  const responseSchema = getSidecarResponseSchema(op) as unknown as Schema.Schema<
    SidecarResponse<Op>,
    unknown,
    never
  >
  const request = parseOrThrow(requestSchema, body)
  const payload = await window.electronAPI.sidecarRequest(op, request as Record<string, unknown>)
  return parseOrThrow(responseSchema, payload)
}
