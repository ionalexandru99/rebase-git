// Git's well-known empty tree object id (SHA-1). Diffing a root commit against it yields the commit's
// full contents as additions — the base used when a commit has no parent to diff against.
export const GIT_EMPTY_TREE_OID = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
