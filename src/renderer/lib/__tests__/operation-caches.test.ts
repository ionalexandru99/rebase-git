import { DeleteBranch } from '@shared/rpc'
import { describe, expect, it } from 'vitest'
import { cachesForOperation } from '../operation-caches'

describe('cachesForOperation', () => {
  it('dirties the branch caches for a branch delete', () => {
    expect(cachesForOperation('deleteBranch')).toEqual(['localBranches', 'remoteRefs'])
  })

  it('dirties the working-tree caches for a discard', () => {
    expect(cachesForOperation('discardChanges')).toEqual(['status', 'diff', 'stash'])
  })

  it('dirties the branch caches for a rename and a tag delete', () => {
    expect(cachesForOperation('renameBranch')).toEqual(['localBranches', 'remoteRefs'])
    expect(cachesForOperation('deleteTag')).toEqual(['localBranches', 'remoteRefs'])
  })

  it('dirties only the stash cache for a stash drop', () => {
    expect(cachesForOperation('stashDrop')).toEqual(['stash'])
  })

  it('is keyed by the typed RPC operation tag', () => {
    expect(cachesForOperation(DeleteBranch._tag)).toEqual(['localBranches', 'remoteRefs'])
  })
})
