import {
  Checkout,
  CherryPick,
  CreateBranch,
  CreateTag,
  DeleteBranch,
  DeleteTag,
  MergeBranch,
  RenameBranch,
  Reset,
  RevertCommit,
  StashApply,
  StashPop
} from '@shared/rpc'
import { describe, expect, it } from 'vitest'
import { cachesForOperation } from '../operation-caches'

describe('cachesForOperation', () => {
  it('dirties the branch caches for a branch delete', () => {
    expect(cachesForOperation('deleteBranch')).toEqual(['localBranches', 'remoteRefs'])
  })

  it('dirties the working-tree caches for a discard', () => {
    expect(cachesForOperation('discardChanges')).toEqual(['status', 'diff', 'stash'])
  })

  it('dirties only the branch caches for a plain create, rename, tag create, and tag delete', () => {
    expect(cachesForOperation('createBranch')).toEqual(['localBranches', 'remoteRefs'])
    expect(cachesForOperation('renameBranch')).toEqual(['localBranches', 'remoteRefs'])
    expect(cachesForOperation('createTag')).toEqual(['localBranches', 'remoteRefs'])
    expect(cachesForOperation('deleteTag')).toEqual(['localBranches', 'remoteRefs'])
  })

  it('dirties the working tree, refs, and timeline for a history op, a checkout, or a create+checkout', () => {
    const union = ['status', 'localBranches', 'remoteRefs', 'diff', 'log']
    expect(cachesForOperation('mergeBranch')).toEqual(union)
    expect(cachesForOperation('reset')).toEqual(union)
    expect(cachesForOperation('revertCommit')).toEqual(union)
    expect(cachesForOperation('cherryPick')).toEqual(union)
    expect(cachesForOperation('checkout')).toEqual(union)
    expect(cachesForOperation('createBranchCheckout')).toEqual(union)
  })

  it('dirties the working-tree caches for a stash apply or pop', () => {
    expect(cachesForOperation('stashApply')).toEqual(['status', 'diff', 'stash'])
    expect(cachesForOperation('stashPop')).toEqual(['status', 'diff', 'stash'])
  })

  it('dirties only the stash cache for a stash drop', () => {
    expect(cachesForOperation('stashDrop')).toEqual(['stash'])
  })

  it('is keyed by the typed RPC operation tag', () => {
    expect(cachesForOperation(Checkout._tag)).toBeDefined()
    expect(cachesForOperation(DeleteBranch._tag)).toEqual(['localBranches', 'remoteRefs'])
    expect(cachesForOperation(CreateBranch._tag)).toBeDefined()
    expect(cachesForOperation(RenameBranch._tag)).toBeDefined()
    expect(cachesForOperation(CreateTag._tag)).toBeDefined()
    expect(cachesForOperation(DeleteTag._tag)).toBeDefined()
    expect(cachesForOperation(MergeBranch._tag)).toBeDefined()
    expect(cachesForOperation(Reset._tag)).toBeDefined()
    expect(cachesForOperation(RevertCommit._tag)).toBeDefined()
    expect(cachesForOperation(CherryPick._tag)).toBeDefined()
    expect(cachesForOperation(StashApply._tag)).toBeDefined()
    expect(cachesForOperation(StashPop._tag)).toBeDefined()
  })
})
