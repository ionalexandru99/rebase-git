type TaggedResult = { _tag: string; message?: string }

export function unwrapOk<Result extends TaggedResult>(
  result: Result
): Extract<Result, { _tag: 'Ok' }> {
  if (result._tag === 'Ok') {
    return result as Extract<Result, { _tag: 'Ok' }>
  }
  if (result._tag === 'GitError') {
    throw new Error(result.message ?? 'Git error')
  }
  if (result._tag === 'RepoNotOpen') {
    throw new Error('Repository not open')
  }
  throw new Error(`Unexpected RPC result: ${result._tag}`)
}
