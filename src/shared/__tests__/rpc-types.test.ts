import {
  AmendRejected,
  Conflict,
  FetchSkipped,
  GitError,
  HunkNotFound,
  NotARepo,
  OperationInProgress,
  PullDiverged,
  PushRejected,
  RepoNotOpen
} from '@shared/git-rpc-errors'
import type {
  SidecarRpcError,
  SidecarRpcErrorResponse,
  SidecarRpcResponse,
  SidecarRpcTag
} from '@shared/rpc'
import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value
const ExpectedErrorSchema = Schema.Union(
  RepoNotOpen,
  NotARepo,
  GitError,
  HunkNotFound,
  Conflict,
  FetchSkipped,
  PullDiverged,
  PushRejected,
  AmendRejected,
  OperationInProgress
)
type ExpectedError = typeof ExpectedErrorSchema.Type
type ExpectedErrorResponse = typeof ExpectedErrorSchema.Encoded
type ExpectedErrorTag = ExpectedError['_tag']
type ErrorTag = SidecarRpcError extends { readonly _tag: infer Tag } ? Tag : never
type ErrorResponseTag = SidecarRpcErrorResponse extends { readonly _tag: infer Tag } ? Tag : never
type ResponseTag = SidecarRpcResponse extends { readonly _tag: infer Tag } ? Tag : never
type ErrorTypeIsDerived = Assert<Equal<SidecarRpcError, ExpectedError>>
type ErrorTagsAreDerived = Assert<Equal<ErrorTag, ExpectedErrorTag>>
type ErrorResponseIsDerived = Assert<Equal<SidecarRpcErrorResponse, ExpectedErrorResponse>>
type ErrorResponseTagsAreDerived = Assert<Equal<ErrorResponseTag, ExpectedErrorTag>>
type ResponseTagsAreDerived = Assert<Equal<ResponseTag, 'Ok' | ExpectedErrorTag>>
type TagsStayLiteral = Assert<string extends SidecarRpcTag ? false : true>

const typeAssertions: [
  ErrorTypeIsDerived,
  ErrorTagsAreDerived,
  ErrorResponseIsDerived,
  ErrorResponseTagsAreDerived,
  ResponseTagsAreDerived,
  TagsStayLiteral
] = [true, true, true, true, true, true]

describe('Sidecar RPC types', () => {
  it('derive tags, errors, and responses from the RPC group', () => {
    expect(typeAssertions).toEqual([true, true, true, true, true, true])
  })
})
