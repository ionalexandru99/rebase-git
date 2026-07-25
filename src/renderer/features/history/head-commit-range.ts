const SHA1_EMPTY_TREE_OID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const SHA256_EMPTY_TREE_OID = '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321'

export function buildHeadCommitRange(parentCount: number, headSha: string): string {
  if (parentCount !== 0) {
    return 'HEAD~1..HEAD'
  }
  const emptyTreeOid = headSha.length === 64 ? SHA256_EMPTY_TREE_OID : SHA1_EMPTY_TREE_OID
  return `${emptyTreeOid}..HEAD`
}
