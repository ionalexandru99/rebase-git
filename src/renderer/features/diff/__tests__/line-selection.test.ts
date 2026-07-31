import { fingerprintHunk } from '@shared/hunk-fingerprint'
import type { DiffHunk } from '@shared/schemas/git'
import { describe, expect, it } from 'vitest'
import {
  mapSelectionToHunkSelections,
  type SelectedChangeLine,
  sweepSelectedChangeLines
} from '@/features/diff/line-selection'

interface RowSpec {
  line: number
  altLine?: number
  type: 'change-addition' | 'change-deletion' | 'context'
  index: string
  selected?: boolean
}

function appendRows(target: ParentNode & Node, rows: RowSpec[]): void {
  for (const spec of rows) {
    const row = document.createElement('div')
    row.setAttribute('data-line', String(spec.line))
    if (spec.altLine !== undefined) {
      row.setAttribute('data-alt-line', String(spec.altLine))
    }
    row.setAttribute('data-line-type', spec.type)
    row.setAttribute('data-line-index', spec.index)
    if (spec.selected !== false) {
      row.setAttribute('data-selected-line', '')
    }
    target.appendChild(row)
  }
}

function shadowHost(rows: RowSpec[]): HTMLElement {
  const container = document.createElement('div')
  const host = document.createElement('diffs-container')
  appendRows(host.shadowRoot ?? host.attachShadow({ mode: 'open' }), rows)
  container.appendChild(host)
  return container
}

function lightHost(rows: RowSpec[]): HTMLElement {
  const container = document.createElement('div')
  const host = document.createElement('diffs-container')
  appendRows(host, rows)
  container.appendChild(host)
  return container
}

describe('sweepSelectedChangeLines', () => {
  it('decodes selected unified rows into change lines and drops context rows', () => {
    const container = shadowHost([
      { line: 1, type: 'change-deletion', index: '0,0' },
      { line: 1, type: 'change-addition', index: '1,0' },
      { line: 2, altLine: 2, type: 'context', index: '2,1' },
      { line: 3, altLine: 3, type: 'context', index: '3,2', selected: false },
      { line: 4, type: 'change-addition', index: '4,3', selected: false }
    ])

    expect(sweepSelectedChangeLines(container)).toEqual([
      { kind: 'del', lineNumber: 1, unifiedIndex: 0 },
      { kind: 'add', lineNumber: 1, unifiedIndex: 1 }
    ])
  })

  it('sorts split-view rows by unified index and dedupes doubly marked context rows', () => {
    const container = shadowHost([
      { line: 10, type: 'change-addition', index: '1,0' },
      { line: 11, altLine: 10, type: 'context', index: '2,1' },
      { line: 10, type: 'change-deletion', index: '0,0' },
      { line: 10, altLine: 11, type: 'context', index: '2,1' }
    ])

    expect(sweepSelectedChangeLines(container)).toEqual([
      { kind: 'del', lineNumber: 10, unifiedIndex: 0 },
      { kind: 'add', lineNumber: 10, unifiedIndex: 1 }
    ])
  })

  it('also sweeps rows rendered into the host light DOM', () => {
    const container = lightHost([{ line: 7, type: 'change-addition', index: '5,4' }])

    expect(sweepSelectedChangeLines(container)).toEqual([
      { kind: 'add', lineNumber: 7, unifiedIndex: 5 }
    ])
  })

  it('collects rows across multiple hosts', () => {
    const container = document.createElement('div')
    container.appendChild(lightHost([{ line: 1, type: 'change-deletion', index: '0,0' }]))
    container.appendChild(lightHost([{ line: 5, type: 'change-addition', index: '3,2' }]))

    expect(sweepSelectedChangeLines(container)).toEqual([
      { kind: 'del', lineNumber: 1, unifiedIndex: 0 },
      { kind: 'add', lineNumber: 5, unifiedIndex: 3 }
    ])
  })

  it('returns an empty list when nothing is selected', () => {
    const container = shadowHost([
      { line: 1, type: 'change-addition', index: '0,0', selected: false }
    ])

    expect(sweepSelectedChangeLines(container)).toEqual([])
  })
})

interface FixtureHunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  context?: string
  body: string[]
}

function fixtureHeader(hunk: FixtureHunk): string {
  const suffix = hunk.context ? ` ${hunk.context}` : ''
  return `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@${suffix}`
}

function fixturePatch(file: string, hunks: FixtureHunk[]): string {
  return `${[
    `diff --git a/${file} b/${file}`,
    'index 1111111..2222222 100644',
    `--- a/${file}`,
    `+++ b/${file}`,
    ...hunks.flatMap((hunk) => [fixtureHeader(hunk), ...hunk.body])
  ].join('\n')}\n`
}

function fixtureHunks(hunks: FixtureHunk[]): DiffHunk[] {
  return hunks.map((hunk) => {
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    return {
      header: fixtureHeader(hunk),
      oldStart: hunk.oldStart,
      oldCount: hunk.oldCount,
      newStart: hunk.newStart,
      newCount: hunk.newCount,
      lines: hunk.body.map((raw) => {
        const text = raw.slice(1)
        if (raw.startsWith('+')) {
          return { kind: 'add' as const, text, oldLine: null, newLine: newLine++ }
        }
        if (raw.startsWith('-')) {
          return { kind: 'del' as const, text, oldLine: oldLine++, newLine: null }
        }
        return { kind: 'context' as const, text, oldLine: oldLine++, newLine: newLine++ }
      })
    }
  })
}

const firstFixture: FixtureHunk = {
  oldStart: 1,
  oldCount: 3,
  newStart: 1,
  newCount: 5,
  body: [' intro', '+added one', '+added two', '-removed', '+replacement', ' outro']
}

const tailFixture: FixtureHunk = {
  oldStart: 30,
  oldCount: 3,
  newStart: 31,
  newCount: 3,
  context: 'function tail() {',
  body: [' before', '-old tail', '+new tail', ' after']
}

const patch = fixturePatch('src/app.ts', [firstFixture, tailFixture])
const hunks = fixtureHunks([firstFixture, tailFixture])
const firstHeader = fixtureHeader(firstFixture)
const tailHeader = fixtureHeader(tailFixture)

describe('mapSelectionToHunkSelections', () => {
  it('maps added lines to their indexes inside the enclosing hunk with its fingerprint', () => {
    const lines: SelectedChangeLine[] = [
      { kind: 'add', lineNumber: 2, unifiedIndex: 1 },
      { kind: 'add', lineNumber: 3, unifiedIndex: 2 }
    ]

    expect(mapSelectionToHunkSelections(hunks, patch, lines)).toEqual([
      {
        hunkHeader: firstHeader,
        lineIndexes: [1, 2],
        fingerprint: fingerprintHunk(patch, firstHeader)
      }
    ])
  })

  it('maps deletions by old line number and groups selections per hunk', () => {
    const lines: SelectedChangeLine[] = [
      { kind: 'del', lineNumber: 2, unifiedIndex: 3 },
      { kind: 'del', lineNumber: 31, unifiedIndex: 8 },
      { kind: 'add', lineNumber: 32, unifiedIndex: 9 }
    ]

    expect(mapSelectionToHunkSelections(hunks, patch, lines)).toEqual([
      {
        hunkHeader: firstHeader,
        lineIndexes: [3],
        fingerprint: fingerprintHunk(patch, firstHeader)
      },
      {
        hunkHeader: tailHeader,
        lineIndexes: [1, 2],
        fingerprint: fingerprintHunk(patch, tailHeader)
      }
    ])
  })

  it('drops selected lines that match no hunk line', () => {
    const lines: SelectedChangeLine[] = [
      { kind: 'add', lineNumber: 999, unifiedIndex: 0 },
      { kind: 'del', lineNumber: 999, unifiedIndex: 1 }
    ]

    expect(mapSelectionToHunkSelections(hunks, patch, lines)).toEqual([])
  })

  it('returns nothing for an empty selection', () => {
    expect(mapSelectionToHunkSelections(hunks, patch, [])).toEqual([])
  })
})
