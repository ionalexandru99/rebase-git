import type { Rpc } from '@effect/rpc'
import type { SidecarRpc, SidecarRpcTag } from '@shared/rpc'
import type { RpcResult } from '@shared/rpc-result'

type MaybePromise<Value> = Value | Promise<Value>

export type RpcWireResult<Contract extends Rpc.Any> = RpcResult<
  Rpc.SuccessExitEncoded<Contract>,
  Rpc.ErrorExitEncoded<Contract>
>

export type RpcResponseHandler<Contract extends SidecarRpc> = (
  payload: Rpc.Payload<Contract>
) => MaybePromise<RpcWireResult<Contract>>

type StoredHandler = (payload: Record<string, unknown>) => MaybePromise<unknown>

export function createSidecarRpcFake() {
  const handlers = new Map<SidecarRpcTag, StoredHandler>()

  const respond = <Contract extends SidecarRpc>(
    contract: Contract,
    handler: RpcResponseHandler<Contract>
  ): void => {
    handlers.set(contract._tag, handler as StoredHandler)
  }

  const request = async (op: string, payload: Record<string, unknown>): Promise<unknown> => {
    const handler = handlers.get(op as SidecarRpcTag)
    if (!handler) {
      throw new Error(`Unexpected sidecar RPC '${op}'`)
    }
    return handler(payload)
  }

  const reset = (): void => {
    handlers.clear()
  }

  return { request, reset, respond }
}
