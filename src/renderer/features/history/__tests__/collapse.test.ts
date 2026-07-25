import { describe, expect, it } from 'vitest'
import type { GitLogEntry } from '@/types'
import {
  collectTimelineTips,
  computeCollapsedView,
  computeMainlineSet,
  computeMergesToReveal,
  mergeGlyphState,
  refFilterKey,
  sideRange
} from '../selectors'

function entry(hash: string, parents: string[] = []): GitLogEntry {
  return {
    hash,
    message: hash,
    author_name: 'Ada',
    date: '2026-01-01T00:00:00Z',
    parents,
    refs: ''
  }
}

// m4 ─┬─ m3 ── m2 ── m1        (mainline, first-parent)
//     └─ f2 ── f1 ┘           (feature side branch, merged at m4, base m2)
const mergeHeavy: GitLogEntry[] = [
  entry('m4', ['m3', 'f2']),
  entry('m3', ['m2']),
  entry('f2', ['f1']),
  entry('f1', ['m2']),
  entry('m2', ['m1']),
  entry('m1', [])
]

function mergeOf(commits: GitLogEntry[], hash: string): GitLogEntry {
  const merge = commits.find((commit) => commit.hash === hash)
  if (!merge) {
    throw new Error(`no commit ${hash}`)
  }
  return merge
}

describe('computeMainlineSet', () => {
  it('unions each tip first-parent-only ancestor chain', () => {
    expect(computeMainlineSet(mergeHeavy, ['m4'])).toEqual(new Set(['m4', 'm3', 'm2', 'm1']))
  })
})

// octo ─┬─ a ── base       (mainline)
//       ├─ b ── base
//       └─ c ── base
const octopus: GitLogEntry[] = [
  entry('octo', ['a', 'b', 'c']),
  entry('a', ['base']),
  entry('b', ['base']),
  entry('c', ['base']),
  entry('base', [])
]

// m3 merges m2 and m1, but m1 is already an ancestor of m2 (a back-merge).
const backMerge: GitLogEntry[] = [entry('m3', ['m2', 'm1']), entry('m2', ['m1']), entry('m1', [])]

describe('sideRange', () => {
  it('reveals the side parent first-parent line bounded at the merge-base', () => {
    const mainline = computeMainlineSet(mergeHeavy, ['m4'])
    expect(sideRange(mergeHeavy, mergeOf(mergeHeavy, 'm4'), mainline)).toEqual(
      new Set(['f2', 'f1'])
    )
  })

  it('reveals every extra parent line of an octopus merge at once', () => {
    const mainline = computeMainlineSet(octopus, ['octo'])
    expect(sideRange(octopus, mergeOf(octopus, 'octo'), mainline)).toEqual(new Set(['b', 'c']))
  })

  it('reveals nothing for a back-merge whose side parent is already on the mainline', () => {
    const mainline = computeMainlineSet(backMerge, ['m3'])
    expect(sideRange(backMerge, mergeOf(backMerge, 'm3'), mainline)).toEqual(new Set())
  })
})

// M1 ─┬─ P ───────── Q ── root       (mainline)
//     └─ M2 ─┬─ B ──┘                (M2's mainline rejoins at Q)
//            └─ C ── D ─┘            (M2's side branch, nested)
const nested: GitLogEntry[] = [
  entry('M1', ['P', 'M2']),
  entry('P', ['Q']),
  entry('M2', ['B', 'C']),
  entry('B', ['Q']),
  entry('C', ['D']),
  entry('D', ['Q']),
  entry('Q', ['root']),
  entry('root', [])
]

// top ─┬─ mid ───────── base       (mainline; two merges share the `shared` commit)
//      │    └─ y ── shared ┘
//      └─ x ── shared ┘
const sharedSide: GitLogEntry[] = [
  entry('top', ['mid', 'x']),
  entry('mid', ['base', 'y']),
  entry('x', ['shared']),
  entry('y', ['shared']),
  entry('shared', ['base']),
  entry('base', [])
]

describe('computeCollapsedView', () => {
  it('shows only the mainline union when nothing is expanded', () => {
    expect(computeCollapsedView(mergeHeavy, ['m4'], new Set())).toEqual(
      new Set(['m4', 'm3', 'm2', 'm1'])
    )
  })

  it('reveals a merge side branch when that merge is expanded', () => {
    expect(computeCollapsedView(mergeHeavy, ['m4'], new Set(['m4']))).toEqual(
      new Set(['m4', 'm3', 'm2', 'm1', 'f2', 'f1'])
    )
  })

  it('expands one level: a nested merge stays collapsed until it too is expanded', () => {
    expect(computeCollapsedView(nested, ['M1'], new Set(['M1']))).toEqual(
      new Set(['M1', 'P', 'Q', 'root', 'M2', 'B'])
    )
    expect(computeCollapsedView(nested, ['M1'], new Set(['M1', 'M2']))).toEqual(
      new Set(['M1', 'P', 'Q', 'root', 'M2', 'B', 'C', 'D'])
    )
  })

  it('ignores an expanded nested merge while its container is collapsed', () => {
    expect(computeCollapsedView(nested, ['M1'], new Set(['M2']))).toEqual(
      new Set(['M1', 'P', 'Q', 'root'])
    )
  })

  it('renders a commit reachable from two expanded merges exactly once', () => {
    const displayed = computeCollapsedView(sharedSide, ['top'], new Set(['top', 'mid']))
    expect(displayed).toEqual(new Set(['top', 'mid', 'base', 'x', 'shared', 'y']))
  })
})

// m merges feature, and feature (f2) is independently a visible tip.
const featureAlsoVisible: GitLogEntry[] = [
  entry('m', ['base', 'f2']),
  entry('f2', ['f1']),
  entry('f1', ['base']),
  entry('base', [])
]

describe('collectTimelineTips', () => {
  it('resolves the tip hash of each visible branch ref', () => {
    const commits = [
      entry('m4', ['m3', 'f2']),
      ...mergeHeavy.slice(1).map((commit) => ({ ...commit }))
    ]
    commits[0] = { ...commits[0], refs: 'HEAD -> main' }
    const tips = collectTimelineTips(
      commits,
      new Set([refFilterKey('local', 'main')]),
      [],
      new Set(['origin'])
    )
    expect(tips).toEqual(['m4'])
  })
})

describe('mergeGlyphState', () => {
  it('marks a collapsed merge with a hidden side branch as expandable', () => {
    const displayed = computeCollapsedView(mergeHeavy, ['m4'], new Set())
    expect(mergeGlyphState(mergeHeavy, mergeOf(mergeHeavy, 'm4'), displayed, new Set())).toBe(
      'collapsed'
    )
  })

  it('marks an expanded merge as expanded', () => {
    const expanded = new Set(['m4'])
    const displayed = computeCollapsedView(mergeHeavy, ['m4'], expanded)
    const collapsed = computeCollapsedView(mergeHeavy, ['m4'], new Set())
    expect(
      mergeGlyphState(mergeHeavy, mergeOf(mergeHeavy, 'm4'), displayed, expanded, collapsed)
    ).toBe('expanded')
  })

  it('shows no glyph for a non-merge commit', () => {
    const displayed = computeCollapsedView(mergeHeavy, ['m4'], new Set())
    expect(mergeGlyphState(mergeHeavy, mergeOf(mergeHeavy, 'm3'), displayed, new Set())).toBe(
      'none'
    )
  })

  it('shows no glyph for a back-merge with nothing to reveal', () => {
    const displayed = computeCollapsedView(backMerge, ['m3'], new Set())
    expect(mergeGlyphState(backMerge, mergeOf(backMerge, 'm3'), displayed, new Set())).toBe('none')
  })

  it('shows no glyph when the side branch is already shown by another visible tip', () => {
    const displayed = computeCollapsedView(featureAlsoVisible, ['m', 'f2'], new Set())
    expect(
      mergeGlyphState(featureAlsoVisible, mergeOf(featureAlsoVisible, 'm'), displayed, new Set())
    ).toBe('none')
  })

  it('shows no expanded glyph after another visible tip exposes the side branch', () => {
    const displayed = computeCollapsedView(featureAlsoVisible, ['m', 'f2'], new Set(['m']))
    const independentlyDisplayed = computeCollapsedView(featureAlsoVisible, ['m', 'f2'], new Set())
    expect(
      mergeGlyphState(
        featureAlsoVisible,
        mergeOf(featureAlsoVisible, 'm'),
        displayed,
        new Set(['m']),
        independentlyDisplayed
      )
    ).toBe('none')
  })

  it('shows no glyph for a merge that is not itself displayed', () => {
    const displayed = computeCollapsedView(nested, ['M1'], new Set())
    expect(mergeGlyphState(nested, mergeOf(nested, 'M2'), displayed, new Set())).toBe('none')
  })
})

describe('computeMergesToReveal', () => {
  it('reveals no merges for a match already on the mainline', () => {
    expect(computeMergesToReveal(mergeHeavy, ['m4'], new Set(['m2']))).toEqual(new Set())
  })

  it('reveals the merge whose side branch holds a one-level-deep match', () => {
    expect(computeMergesToReveal(mergeHeavy, ['m4'], new Set(['f1']))).toEqual(new Set(['m4']))
  })

  it('reveals the full chain of merges for a deeply nested match', () => {
    expect(computeMergesToReveal(nested, ['M1'], new Set(['D']))).toEqual(new Set(['M1', 'M2']))
  })

  it('reveals the octopus merge for a match on one of its extra parent lines', () => {
    expect(computeMergesToReveal(octopus, ['octo'], new Set(['c']))).toEqual(new Set(['octo']))
  })

  it('reveals nothing for a match not reachable from the visible tips', () => {
    expect(computeMergesToReveal(mergeHeavy, ['m2'], new Set(['f1']))).toEqual(new Set())
  })

  it('unions the reveal chains of several matches', () => {
    expect(computeMergesToReveal(sharedSide, ['top'], new Set(['shared']))).toEqual(
      new Set(['top'])
    )
    expect(computeMergesToReveal(sharedSide, ['top'], new Set(['shared', 'y']))).toEqual(
      new Set(['top', 'mid'])
    )
  })

  it('produces an expansion set whose collapsed view surfaces every reachable match', () => {
    const matches = new Set(['D', 'B'])
    const reveal = computeMergesToReveal(nested, ['M1'], matches)
    const displayed = computeCollapsedView(nested, ['M1'], reveal)
    for (const match of matches) {
      expect(displayed.has(match)).toBe(true)
    }
  })
})
