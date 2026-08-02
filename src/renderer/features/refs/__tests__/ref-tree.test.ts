import { REF_TREE_REMOTE_SECTION_KEY, REF_TREE_TAG_SECTION_KEY } from '@shared/ref-tree-toggles'
import { describe, expect, it } from 'vitest'
import { buildRefTreeRows as buildRefTreeRowsFrom, folderKey } from '../ref-tree'

type RefTreeOptions = Parameters<typeof buildRefTreeRowsFrom>[0]

function buildRefTreeRows(overrides: Partial<RefTreeOptions> = {}) {
  return buildRefTreeRowsFrom({
    localBranches: ['main'],
    remoteBranches: [],
    tags: [],
    toggles: new Set(),
    currentBranch: 'main',
    localLoading: false,
    ...overrides
  })
}

function rowsFor(toggles: Set<string> = new Set()) {
  return buildRefTreeRows({
    localBranches: ['main', 'feature/foo'],
    remoteBranches: ['origin/main'],
    tags: ['v1.0.0'],
    toggles
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

  it('in-memory toggles can expand remote and collapse local', () => {
    const rows = rowsFor(new Set(['section:local', REF_TREE_REMOTE_SECTION_KEY]))
    const localSection = rows.find((r) => r.kind === 'section' && r.refKind === 'local')
    const remoteSection = rows.find((r) => r.kind === 'section' && r.refKind === 'remote')
    expect(localSection?.kind === 'section' && localSection.expanded).toBe(false)
    expect(remoteSection?.kind === 'section' && remoteSection.expanded).toBe(true)
  })
})

describe('ref-tree stashes section', () => {
  const stashes = [
    { index: 0, ref: 'stash@{0}', oid: 'stash-oid-0', message: 'wip', branch: 'main' },
    { index: 1, ref: 'stash@{1}', oid: 'stash-oid-1', message: 'older', branch: 'main' }
  ]

  it('omits the stashes section when there are no stashes', () => {
    const rows = buildRefTreeRows({
      stashes: []
    })
    expect(rows.some((row) => row.kind === 'section' && row.refKind === 'stash')).toBe(false)
  })

  it('renders an expanded stashes section with one row per stash', () => {
    const rows = buildRefTreeRows({
      stashes
    })
    const section = rows.find((row) => row.kind === 'section' && row.refKind === 'stash')
    expect(section?.kind === 'section' && section.expanded).toBe(true)
    expect(section?.kind === 'section' && section.count).toBe(2)
    const stashRows = rows.filter((row) => row.kind === 'stash')
    expect(stashRows).toHaveLength(2)
    expect(stashRows[0].kind === 'stash' && stashRows[0].index).toBe(0)
    expect(stashRows[0].kind === 'stash' && stashRows[0].message).toBe('wip')
  })

  it('collapses the stashes section when toggled', () => {
    const rows = buildRefTreeRows({
      toggles: new Set(['section:stash']),
      stashes
    })
    const section = rows.find((row) => row.kind === 'section' && row.refKind === 'stash')
    expect(section?.kind === 'section' && section.expanded).toBe(false)
    expect(rows.some((row) => row.kind === 'stash')).toBe(false)
  })
})

describe('ref-tree loading skeleton', () => {
  it('shows local skeleton only while remote and tags stay collapsed', () => {
    const rows = buildRefTreeRows({
      localBranches: [],
      localLoading: true
    })
    expect(rows.some((row) => row.kind === 'skeleton' && row.refKind === 'local')).toBe(true)
    expect(rows.some((row) => row.kind === 'skeleton' && row.refKind === 'remote')).toBe(false)
    expect(rows.some((row) => row.kind === 'skeleton' && row.refKind === 'tag')).toBe(false)
    const remoteSection = rows.find((row) => row.kind === 'section' && row.refKind === 'remote')
    const tagSection = rows.find((row) => row.kind === 'section' && row.refKind === 'tag')
    expect(remoteSection?.kind === 'section' && remoteSection.expanded).toBe(false)
    expect(tagSection?.kind === 'section' && tagSection.expanded).toBe(false)
  })
})

describe('ref-tree name filter', () => {
  it('narrows local branches to fuzzy matches of the query', () => {
    const rows = buildRefTreeRows({
      localBranches: ['main', 'develop'],
      query: 'main'
    })
    const localLeaves = rows.filter((row) => row.kind === 'leaf' && row.refKind === 'local')
    expect(localLeaves.map((row) => row.kind === 'leaf' && row.fullPath)).toEqual(['main'])
  })

  it('returns the unfiltered tree unchanged for a blank query', () => {
    const options = {
      localBranches: ['main', 'feature/foo'],
      remoteBranches: ['origin/main'],
      tags: ['v1.0.0'],
      stashes: [{ index: 0, ref: 'stash@{0}', oid: 'stash-oid-0', message: 'wip', branch: 'main' }]
    }
    const unfiltered = buildRefTreeRows(options)
    expect(buildRefTreeRows({ ...options, query: '   ' })).toEqual(unfiltered)
  })

  it('filters tags and stashes by the query', () => {
    const rows = buildRefTreeRows({
      localBranches: [],
      tags: ['v1-main', 'v2-dev'],
      toggles: new Set([REF_TREE_TAG_SECTION_KEY]),
      stashes: [
        {
          index: 0,
          ref: 'stash@{0}',
          oid: 'stash-oid-0',
          message: 'main wip',
          branch: 'main'
        },
        { index: 1, ref: 'stash@{1}', oid: 'stash-oid-1', message: 'other', branch: 'main' }
      ],
      query: 'main'
    })
    const tagLeaves = rows.filter((row) => row.kind === 'leaf' && row.refKind === 'tag')
    expect(tagLeaves.map((row) => row.kind === 'leaf' && row.fullPath)).toEqual(['v1-main'])
    const stashRows = rows.filter((row) => row.kind === 'stash')
    expect(stashRows.map((row) => row.kind === 'stash' && row.index)).toEqual([0])
  })

  it('auto-expands matching sections and folders regardless of collapse toggles', () => {
    const rows = buildRefTreeRows({
      remoteBranches: ['origin/feature/login'],
      query: 'login'
    })
    const remoteSection = rows.find((row) => row.kind === 'section' && row.refKind === 'remote')
    expect(remoteSection?.kind === 'section' && remoteSection.expanded).toBe(true)
    const originFolder = rows.find((row) => row.kind === 'folder' && row.fullPath === 'origin')
    expect(originFolder?.kind === 'folder' && originFolder.expanded).toBe(true)
    expect(rows.some((row) => row.kind === 'leaf' && row.fullPath === 'origin/feature/login')).toBe(
      true
    )
  })

  it('matches the full ref path by folder segment and by subsequence', () => {
    const base = {
      localBranches: ['feature/login', 'release'],
      remoteBranches: ['origin/main', 'upstream/dev']
    }
    const byFolderSegment = buildRefTreeRows({ ...base, query: 'origin' })
    expect(
      byFolderSegment.some((row) => row.kind === 'leaf' && row.fullPath === 'origin/main')
    ).toBe(true)
    expect(
      byFolderSegment.some((row) => row.kind === 'leaf' && row.fullPath === 'upstream/dev')
    ).toBe(false)

    const bySubsequence = buildRefTreeRows({ ...base, query: 'flog' })
    expect(
      bySubsequence.some((row) => row.kind === 'leaf' && row.fullPath === 'feature/login')
    ).toBe(true)
    expect(bySubsequence.some((row) => row.kind === 'leaf' && row.fullPath === 'release')).toBe(
      false
    )
  })

  it('keeps stable alphabetical order rather than fuzzy score order', () => {
    const rows = buildRefTreeRows({
      localBranches: ['zeta-feature', 'feature', 'alpha-feature'],
      query: 'feature'
    })
    const localLeaves = rows.filter((row) => row.kind === 'leaf' && row.refKind === 'local')
    expect(localLeaves.map((row) => row.kind === 'leaf' && row.fullPath)).toEqual([
      'alpha-feature',
      'feature',
      'zeta-feature'
    ])
  })

  it('prunes sections and folders that have no matching descendant', () => {
    const rows = buildRefTreeRows({
      localBranches: ['feature/login', 'feature/logout', 'archive/old', 'release'],
      remoteBranches: ['origin/main'],
      tags: ['v1.0.0'],
      query: 'login'
    })
    expect(rows.some((row) => row.kind === 'section' && row.refKind === 'remote')).toBe(false)
    expect(rows.some((row) => row.kind === 'section' && row.refKind === 'tag')).toBe(false)
    expect(rows.some((row) => row.kind === 'section' && row.refKind === 'local')).toBe(true)
    expect(rows.some((row) => row.kind === 'empty')).toBe(false)
    expect(rows.some((row) => row.kind === 'folder' && row.fullPath === 'archive')).toBe(false)
    const localLeaves = rows.filter((row) => row.kind === 'leaf' && row.refKind === 'local')
    expect(localLeaves.map((row) => row.kind === 'leaf' && row.fullPath)).toEqual(['feature/login'])
  })

  it('never mutates the passed collapse toggles', () => {
    const toggles = new Set(['section:local'])
    const before = new Set(toggles)
    buildRefTreeRows({
      localBranches: ['feature/login'],
      remoteBranches: ['origin/feature/login'],
      toggles,
      query: 'login'
    })
    expect(toggles).toEqual(before)
  })

  it('counts only the filtered matches in the section header', () => {
    const rows = buildRefTreeRows({
      localBranches: ['feature/login', 'feature/logbook', 'release'],
      query: 'log'
    })
    const localSection = rows.find((row) => row.kind === 'section' && row.refKind === 'local')
    expect(localSection?.kind === 'section' && localSection.count).toBe(2)
  })

  it('renders a single "No matching refs" empty row when nothing matches', () => {
    const rows = buildRefTreeRows({
      remoteBranches: ['origin/main'],
      tags: ['v1.0.0'],
      stashes: [{ index: 0, ref: 'stash@{0}', oid: 'stash-oid-0', message: 'wip', branch: 'main' }],
      query: 'zzzznomatch'
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('empty')
    expect(rows[0].kind === 'empty' && rows[0].label).toBe('No matching refs')
  })
})

describe('ref-tree tracking attachment to local leaves', () => {
  it('attaches ahead/behind to flat local leaf rows', () => {
    const rows = buildRefTreeRows({
      localBranches: ['main', 'develop'],
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
      tracking: { main: { ahead: 1, behind: 0 } }
    })
    const untracked = rows.find((r) => r.kind === 'leaf' && r.fullPath === 'untracked')
    expect(untracked?.kind === 'leaf' && untracked.ahead).toBeUndefined()
    expect(untracked?.kind === 'leaf' && untracked.behind).toBeUndefined()
  })
})

describe('ref-tree freshness attachment', () => {
  function freshRows() {
    return buildRefTreeRows({
      localBranches: ['main', 'develop'],
      remoteBranches: ['origin/main'],
      tags: ['v1.0.0'],
      toggles: new Set([
        REF_TREE_REMOTE_SECTION_KEY,
        REF_TREE_TAG_SECTION_KEY,
        folderKey('remote', 'origin')
      ]),
      stashes: [
        {
          index: 0,
          ref: 'stash@{0}',
          oid: 'stash-oid-0',
          message: 'wip',
          branch: 'main',
          lastCommitAt: '2026-07-31T12:00:00.000Z'
        }
      ]
    })
  }

  it('carries the stash last commit date onto the stash row', () => {
    const stashRow = freshRows().find((row) => row.kind === 'stash')
    expect(stashRow?.kind === 'stash' && stashRow.lastCommitAt).toBe('2026-07-31T12:00:00.000Z')
  })

  it('leaves branch and tag rows undated', () => {
    const dated = freshRows().filter((row) => row.kind === 'leaf' && 'lastCommitAt' in row)
    expect(dated).toEqual([])
  })
})
