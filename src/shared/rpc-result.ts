import { Schema } from 'effect'

export type RpcContract<Success, SuccessInput, Failure, FailureInput> = {
  readonly _tag: string
  readonly successSchema: Schema.Schema<Success, SuccessInput>
  readonly errorSchema: Schema.Schema<Failure, FailureInput>
}

export type RpcResult<Success, Failure> =
  | Failure
  | (Success extends void ? { _tag: 'Ok' } : { _tag: 'Ok' } & Success)

export type RpcEncodedResult<
  Success extends Schema.Schema.All,
  Failure extends Schema.Schema.All
> = RpcResult<Schema.Schema.Encoded<Success>, Schema.Schema.Encoded<Failure>>

const OkResult = Schema.Struct({ _tag: Schema.Literal('Ok') })
const resultSchemas = new WeakMap<object, Schema.Schema.Any>()

export function rpcResultSchema<Success, SuccessInput, Failure, FailureInput>(
  rpc: RpcContract<Success, SuccessInput, Failure, FailureInput>
): Schema.Schema<RpcResult<Success, Failure>, unknown> {
  const cached = resultSchemas.get(rpc)
  if (cached) {
    return cached as Schema.Schema<RpcResult<Success, Failure>, unknown>
  }
  const success =
    (rpc.successSchema as Schema.Schema.Any) === Schema.Void
      ? OkResult
      : OkResult.pipe(Schema.extend(rpc.successSchema as Schema.Schema<Record<string, unknown>>))
  const result = Schema.Union(success, rpc.errorSchema) as Schema.Schema<
    RpcResult<Success, Failure>,
    unknown
  >
  resultSchemas.set(rpc, result)
  return result
}
