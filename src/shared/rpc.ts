import { Rpc, RpcGroup } from '@effect/rpc'
import { SidecarOp } from './sidecar-ops'
import { getSidecarRequestSchema, getSidecarResponseSchema } from './sidecar-registry'

export const SidecarRpcs = RpcGroup.make(
  ...Object.values(SidecarOp).map((op) =>
    Rpc.make(op, {
      payload: getSidecarRequestSchema(op),
      success: getSidecarResponseSchema(op)
    })
  )
)
