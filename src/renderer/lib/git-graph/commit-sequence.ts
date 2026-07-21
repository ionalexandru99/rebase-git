interface CommitIdentity {
  hash: string
}

export function matchesCommitPrefix(
  expected: readonly CommitIdentity[],
  actual: readonly CommitIdentity[],
  length = expected.length
): boolean {
  if (length < 0 || expected.length < length || actual.length < length) {
    return false
  }
  for (let index = 0; index < length; index++) {
    if (expected[index]?.hash !== actual[index]?.hash) {
      return false
    }
  }
  return true
}
