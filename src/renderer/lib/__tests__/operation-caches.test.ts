import type { SidecarRpcTag } from '@shared/rpc'
import {
  Checkout,
  CherryPick,
  CreateBranch,
  CreateTag,
  DeleteBranch,
  DeleteTag,
  MergeBranch,
  Push,
  RenameBranch,
  Reset,
  RevertCommit,
  StashApply,
  StashPop
} from '@shared/rpc'
import { describe, expect, it } from 'vitest'
import { cachesForOperation, cachesForRepoChange, type MappedOperation } from '../operation-caches'

type Assert<Value extends true> = Value
type RpcMappedOperation = Exclude<MappedOperation, 'createBranchCheckout'>
type MappedOperationsAreRpcTags = Assert<
  Exclude<RpcMappedOperation, SidecarRpcTag> extends never ? true : false
>
type ReadRpcIsNotMapped = Assert<'getStatus' extends MappedOperation ? false : true>

const typeAssertions: [MappedOperationsAreRpcTags, ReadRpcIsNotMapped] = [true, true]

describe('cachesForRepoChange', () => {
  it('dirties the branch, timeline, and stash caches for an external ref move', () => {
    expect(cachesForRepoChange('refs')).toEqual([
      'localBranches',
      'remoteRefs',
      'log',
      'stash',
      'headCommit'
    ])
  })

  it('dirties the working-tree caches for a working-tree change', () => {
    expect(cachesForRepoChange('workingTree')).toEqual(['status', 'diff', 'stash'])
  })

  it('dirties the working-tree caches for an index change', () => {
    expect(cachesForRepoChange('index')).toEqual(['status', 'diff', 'stash'])
  })
})

describe('cachesForOperation', () => {
  it('keeps renderer cache operation types tied to SidecarRpcs', () => {
    expect(typeAssertions).toEqual([true, true])
  })

  it('dirties the branch caches for a branch delete', () => {
    expect(cachesForOperation('deleteBranch')).toEqual(['localBranches', 'remoteRefs'])
  })

  it('dirties the working-tree caches for a discard', () => {
    expect(cachesForOperation('discardChanges')).toEqual(['status', 'diff', 'stash'])
  })

  it('directly refreshes the timeline after a push', () => {
    expect(cachesForOperation(Push._tag)).toContain('log')
  })

  it('dirties only the branch caches for a plain create, rename, tag create, and tag delete', () => {
    expect(cachesForOperation('createBranch')).toEqual(['localBranches', 'remoteRefs'])
    expect(cachesForOperation('renameBranch')).toEqual(['localBranches', 'remoteRefs'])
    expect(cachesForOperation('createTag')).toEqual(['localBranches', 'remoteRefs'])
    expect(cachesForOperation('deleteTag')).toEqual(['localBranches', 'remoteRefs'])
  })

  it('dirties the working tree, refs, and timeline for a history op, a checkout, or a create+checkout', () => {
    const union = ['status', 'localBranches', 'remoteRefs', 'diff', 'log', 'headCommit']
    expect(cachesForOperation('mergeBranch')).toEqual(union)
    expect(cachesForOperation('reset')).toEqual(union)
    expect(cachesForOperation('revertCommit')).toEqual(union)
    expect(cachesForOperation('cherryPick')).toEqual(union)
    expect(cachesForOperation('checkout')).toEqual(union)
    expect(cachesForOperation('createBranchCheckout')).toEqual(union)
  })

  it('additionally dirties the stash cache for a rebase, which can park an autostash', () => {
    expect(cachesForOperation('rebaseOnto')).toEqual([
      'status',
      'localBranches',
      'remoteRefs',
      'diff',
      'log',
      'headCommit',
      'stash'
    ])
  })

  it('dirties the working-tree caches for a stash apply or pop', () => {
    expect(cachesForOperation('stashApply')).toEqual(['status', 'diff', 'stash'])
    expect(cachesForOperation('stashPop')).toEqual(['status', 'diff', 'stash'])
  })

  it('invalidates the amend prefill when an operation can move HEAD', () => {
    expect(cachesForOperation('commit')).toContain('headCommit')
    expect(cachesForOperation('amendCommit')).toContain('headCommit')
    expect(cachesForOperation('checkout')).toContain('headCommit')
    expect(cachesForRepoChange('refs')).toContain('headCommit')
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
