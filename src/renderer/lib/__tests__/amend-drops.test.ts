import { describe, expect, it } from 'vitest'
import {
  assembleDrops,
  dropStateOf,
  type FileDrops,
  hunkDropped,
  toggleFileDrop,
  toggleHunkDrop
} from '@/lib/amend-drops'

const drops = (entries: [string, 'all' | string[]][]): FileDrops =>
  new Map(entries.map(([file, value]) => [file, value === 'all' ? 'all' : new Set(value)]))

describe('dropStateOf', () => {
  it('is kept when the file is absent, dropped when whole, partial when some hunks', () => {
    const state = drops([
      ['whole.ts', 'all'],
      ['part.ts', ['@@ -1 +1 @@']]
    ])
    expect(dropStateOf(state, 'clean.ts')).toBe('kept')
    expect(dropStateOf(state, 'whole.ts')).toBe('dropped')
    expect(dropStateOf(state, 'part.ts')).toBe('partial')
  })
})

describe('toggleFileDrop', () => {
  it('drops a kept file wholesale and keeps it back from any dropped state', () => {
    expect(dropStateOf(toggleFileDrop(drops([]), 'a.ts'), 'a.ts')).toBe('dropped')
    expect(dropStateOf(toggleFileDrop(drops([['a.ts', 'all']]), 'a.ts'), 'a.ts')).toBe('kept')
    expect(dropStateOf(toggleFileDrop(drops([['a.ts', ['h1']]]), 'a.ts'), 'a.ts')).toBe('kept')
  })
})

describe('toggleHunkDrop', () => {
  const all = ['h1', 'h2', 'h3']

  it('drops a single hunk of a kept file into a partial state', () => {
    const next = toggleHunkDrop(drops([]), 'a.ts', 'h1', all)
    expect(dropStateOf(next, 'a.ts')).toBe('partial')
    expect(hunkDropped(next, 'a.ts', 'h1')).toBe(true)
    expect(hunkDropped(next, 'a.ts', 'h2')).toBe(false)
  })

  it('promotes to a whole-file drop when the last kept hunk is dropped', () => {
    let next = toggleHunkDrop(drops([['a.ts', ['h1', 'h2']]]), 'a.ts', 'h3', all)
    expect(dropStateOf(next, 'a.ts')).toBe('dropped')
    next = toggleHunkDrop(next, 'a.ts', 'h1', all)
    expect(dropStateOf(next, 'a.ts')).toBe('partial')
    expect(hunkDropped(next, 'a.ts', 'h1')).toBe(false)
  })

  it('un-drops the last dropped hunk back to kept', () => {
    const next = toggleHunkDrop(drops([['a.ts', ['h1']]]), 'a.ts', 'h1', all)
    expect(dropStateOf(next, 'a.ts')).toBe('kept')
  })
})

describe('assembleDrops', () => {
  it('splits whole-file drops from per-hunk drops', () => {
    const { droppedHeadPaths, droppedHeadHunks } = assembleDrops(
      drops([
        ['whole.ts', 'all'],
        ['part.ts', ['h2', 'h1']]
      ])
    )
    expect(droppedHeadPaths).toEqual(['whole.ts'])
    expect(droppedHeadHunks).toEqual([{ file: 'part.ts', hunks: ['h2', 'h1'] }])
  })
})
