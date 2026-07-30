import { describe, expect, it } from 'vitest'
import {
  buildGraphTopology,
  type GraphTopology,
  parentIdsOf,
  sharedTopologyRows,
  sliceTopology
} from '@/features/history/graph/topology'
import type { GitLogEntry } from '@/types'

function entry(hash: string, parents: string[] = []): GitLogEntry {
  return {
    hash,
    message: hash,
    author_name: 'Author',
    date: '2024-01-01T00:00:00.000Z',
    parents,
    refs: ''
  }
}

function build(commits: GitLogEntry[], isHiddenParent?: (hash: string) => boolean): GraphTopology {
  return buildGraphTopology(commits, { isHiddenParent })
}

describe('buildGraphTopology', () => {
  it('resolves parents to the row that carries them', () => {
    const topology = build([entry('a', ['b']), entry('b', ['c']), entry('c')])

    expect([...parentIdsOf(topology, 0)]).toEqual([1])
    expect([...parentIdsOf(topology, 1)]).toEqual([2])
    expect([...parentIdsOf(topology, 2)]).toEqual([])
    expect(topology.commitCount).toBe(3)
  })

  it('drops parents hidden by a collapsed merge', () => {
    const topology = build([entry('m', ['a', 'side']), entry('a')], (hash) => hash === 'side')

    expect([...parentIdsOf(topology, 0)]).toEqual([1])
  })

  it('gives each not-yet-streamed parent its own stable id outside the row range', () => {
    const topology = build([entry('m', ['pending', 'other']), entry('m2', ['pending'])])

    const [pending, other] = parentIdsOf(topology, 0)
    expect(pending).toBeLessThan(0)
    expect(other).toBeLessThan(0)
    expect(pending).not.toBe(other)
    expect([...parentIdsOf(topology, 1)]).toEqual([pending])
  })

  it('keeps a duplicated parent listed once per occurrence so lane dedupe stays in the layout', () => {
    const topology = build([entry('m', ['a', 'a']), entry('a')])

    expect([...parentIdsOf(topology, 0)]).toEqual([1, 1])
  })
})

describe('sliceTopology', () => {
  it('keeps global row numbering so parent ids stay meaningful', () => {
    const full = build([entry('a', ['b']), entry('b', ['c']), entry('c')])
    const tail = sliceTopology(full, 1)

    expect(tail.firstRow).toBe(1)
    expect(tail.commitCount).toBe(3)
    expect([...parentIdsOf(tail, 1)]).toEqual([2])
    expect([...parentIdsOf(tail, 2)]).toEqual([])
  })

  it('copies rather than views so the source survives a transfer', () => {
    const full = build([entry('a', ['b']), entry('b')])
    const tail = sliceTopology(full, 1)

    expect(tail.parentIds.buffer).not.toBe(full.parentIds.buffer)
    expect(tail.parentOffsets.buffer).not.toBe(full.parentOffsets.buffer)
  })

  it('returns the whole topology when slicing from the start', () => {
    const full = build([entry('a', ['b']), entry('b')])
    const tail = sliceTopology(full, 0)

    expect(tail.firstRow).toBe(0)
    expect([...tail.parentIds]).toEqual([...full.parentIds])
  })
})

describe('sharedTopologyRows', () => {
  it('stops where a parent resolved from pending to a real row', () => {
    const previous = build([entry('a', ['b']), entry('b')])
    const next = build([entry('a', ['b']), entry('b', ['c']), entry('c')])

    expect(sharedTopologyRows(previous, next)).toBe(1)
  })

  it('carries over every row when appended commits do not touch existing parents', () => {
    const previous = build([entry('a', ['b']), entry('b')])
    const next = build([entry('a', ['b']), entry('b'), entry('z')])

    expect(sharedTopologyRows(previous, next)).toBe(2)
  })

  it('stops at the first row whose parents changed', () => {
    const previous = build([entry('a', ['b']), entry('b'), entry('c')])
    const next = build([entry('a', ['b']), entry('x'), entry('c')])

    expect(sharedTopologyRows(previous, next)).toBe(0)
  })

  it('shares rows whose shape is identical even when the commits differ', () => {
    const previous = build([entry('a'), entry('b', ['c']), entry('c')])
    const next = build([entry('z'), entry('b', ['c']), entry('c')])

    expect(sharedTopologyRows(previous, next)).toBe(3)
  })

  it('never reports more rows than either side holds', () => {
    const previous = build([entry('a'), entry('b')])
    const next = build([entry('a')])

    expect(sharedTopologyRows(previous, next)).toBe(1)
  })
})
