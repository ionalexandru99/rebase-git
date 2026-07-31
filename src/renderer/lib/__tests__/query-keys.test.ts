import { describe, expect, it } from 'vitest'
import { repoQueryKeys } from '../query-keys'

describe('repoQueryKeys', () => {
  it('builds stable status, branch, and log keys inside the repo namespace', () => {
    const keys = repoQueryKeys('/repos/example')

    expect(keys.root).toEqual(['repo', '/repos/example'])
    expect(keys.status).toEqual(['repo', '/repos/example', 'status'])
    expect(keys.localBranches).toEqual(['repo', '/repos/example', 'local-branches'])
    expect(keys.remoteRefs).toEqual(['repo', '/repos/example', 'remote-refs'])
    expect(keys.log).toEqual(['repo', '/repos/example', 'log'])
    expect(keys.status).toEqual(repoQueryKeys('/repos/example').status)
    expect(keys.localBranches).toEqual(repoQueryKeys('/repos/example').localBranches)
    expect(keys.remoteRefs).toEqual(repoQueryKeys('/repos/example').remoteRefs)
    expect(keys.log).toEqual(repoQueryKeys('/repos/example').log)
  })

  it('builds stash keys inside the repo namespace', () => {
    const keys = repoQueryKeys('/repos/example')

    expect(keys.stash).toEqual(['repo', '/repos/example', 'stash'])
    expect(keys.stash).toEqual(repoQueryKeys('/repos/example').stash)
  })

  it('builds diff keys inside the repo namespace', () => {
    const keys = repoQueryKeys('/repos/example')

    expect(keys.diffRoot).toEqual(['repo', '/repos/example', 'diff'])
    expect(keys.diff('src/App.tsx', false)).toEqual([
      'repo',
      '/repos/example',
      'diff',
      'src/App.tsx',
      false
    ])
    expect(keys.diff('src/App.tsx', false)).toEqual(
      repoQueryKeys('/repos/example').diff('src/App.tsx', false)
    )
  })

  it('builds idle fallback keys through the same builder', () => {
    const keys = repoQueryKeys(null, { idle: 'tab-1' })

    expect(keys.status).toEqual(['repo', 'idle', 'tab-1', 'status'])
    expect(keys.diff('src/App.tsx', true)).toEqual([
      'repo',
      'idle',
      'tab-1',
      'diff',
      'src/App.tsx',
      true
    ])
  })
})
