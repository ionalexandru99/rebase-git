import { describe, expect, it } from 'vitest'
import { buildRefTreeRows, sectionKey } from '../ref-tree'

function rowsFor(toggles: Set<string> = new Set()) {
  return buildRefTreeRows({
    localBranches: ['main', 'feature/foo'],
    remoteBranches: ['origin/main'],
    tags: ['v1.0.0'],
    toggles,
    currentBranch: 'main',
    loading: false
  })
}

describe('ref-tree default section expansion', () => {
  it('local branches default to expanded', () => {
    const rows = rowsFor()
    const localSection = rows.find((r) => r.kind === 'section' && r.refKind === 'local')
    expect(localSection?.kind === 'section' && localSection.expanded).toBe(true)
  })

  it('remote branches default to collapsed', () => {
    const rows = rowsFor()
    const remoteSection = rows.find((r) => r.kind === 'section' && r.refKind === 'remote')
    expect(remoteSection?.kind === 'section' && remoteSection.expanded).toBe(false)
    expect(rows.some((r) => r.kind === 'leaf' && r.refKind === 'remote')).toBe(false)
  })

  it('tags default to collapsed', () => {
    const rows = rowsFor()
    const tagSection = rows.find((r) => r.kind === 'section' && r.refKind === 'tag')
    expect(tagSection?.kind === 'section' && tagSection.expanded).toBe(false)
    expect(rows.some((r) => r.kind === 'leaf' && r.refKind === 'tag')).toBe(false)
  })

  it('persisted toggles can expand remote and collapse local', () => {
    const rows = rowsFor(new Set([sectionKey('local'), sectionKey('remote')]))
    const localSection = rows.find((r) => r.kind === 'section' && r.refKind === 'local')
    const remoteSection = rows.find((r) => r.kind === 'section' && r.refKind === 'remote')
    expect(localSection?.kind === 'section' && localSection.expanded).toBe(false)
    expect(remoteSection?.kind === 'section' && remoteSection.expanded).toBe(true)
  })
})

describe('ref-tree tracking attachment to local leaves', () => {
  it('attaches ahead/behind to flat local leaf rows', () => {
    const rows = buildRefTreeRows({
      localBranches: ['main', 'develop'],
      remoteBranches: [],
      tags: [],
      toggles: new Set(),
      currentBranch: 'main',
      loading: false,
      tracking: {
        main: { ahead: 2, behind: 1 },
        develop: { ahead: 0, behind: 3 }
      }
    })
    const mainLeaf = rows.find((r) => r.kind === 'leaf' && r.fullPath === 'main')
    const developLeaf = rows.find((r) => r.kind === 'leaf' && r.fullPath === 'develop')
    expect(mainLeaf?.kind === 'leaf' && mainLeaf.ahead).toBe(2)
    expect(mainLeaf?.kind === 'leaf' && mainLeaf.behind).toBe(1)
    expect(developLeaf?.kind === 'leaf' && developLeaf.ahead).toBe(0)
    expect(developLeaf?.kind === 'leaf' && developLeaf.behind).toBe(3)
  })

  it('does not attach tracking to leaves that have no entry in the map', () => {
    const rows = buildRefTreeRows({
      localBranches: ['main', 'untracked'],
      remoteBranches: [],
      tags: [],
      toggles: new Set(),
      currentBranch: 'main',
      loading: false,
      tracking: { main: { ahead: 1, behind: 0 } }
    })
    const untracked = rows.find((r) => r.kind === 'leaf' && r.fullPath === 'untracked')
    expect(untracked?.kind === 'leaf' && untracked.ahead).toBeUndefined()
    expect(untracked?.kind === 'leaf' && untracked.behind).toBeUndefined()
  })
})
