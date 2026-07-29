import { describe, expect, it } from 'vitest'
import { conflictRowActions } from '@/features/status/conflict-resolution'

const labels = { oursLabel: 'main', theirsLabel: 'feature/login' }

describe('conflictRowActions — both sides have content', () => {
  it('names both real refs for a both-modified conflict', () => {
    const actions = conflictRowActions('UU', labels)

    expect(actions.choices).toEqual([
      { label: 'Keep main', side: 'ours' },
      { label: 'Keep feature/login', side: 'theirs' }
    ])
    expect(actions.note).toBeNull()
  })

  it('names both real refs for a both-added conflict', () => {
    expect(conflictRowActions('AA', labels).choices).toEqual([
      { label: 'Keep main', side: 'ours' },
      { label: 'Keep feature/login', side: 'theirs' }
    ])
  })

  it('falls back to neutral wording when no operation supplies ref labels', () => {
    expect(conflictRowActions('UU', null).choices).toEqual([
      { label: 'Keep the current version', side: 'ours' },
      { label: 'Keep the incoming version', side: 'theirs' }
    ])
  })
})

describe('conflictRowActions — modify/delete', () => {
  it('keeps the file from the other side when this side deleted it (DU)', () => {
    const actions = conflictRowActions('DU', labels)

    expect(actions.choices).toEqual([
      { label: 'Keep the file', side: 'theirs' },
      { label: 'Delete the file', side: 'ours' }
    ])
    expect(actions.note).toBeNull()
  })

  it('keeps this side’s file when the other side deleted it (UD)', () => {
    expect(conflictRowActions('UD', labels).choices).toEqual([
      { label: 'Keep the file', side: 'ours' },
      { label: 'Delete the file', side: 'theirs' }
    ])
  })

  it('keeps this side’s file when only this side added it (AU)', () => {
    expect(conflictRowActions('AU', labels).choices).toEqual([
      { label: 'Keep the file', side: 'ours' },
      { label: 'Delete the file', side: 'theirs' }
    ])
  })

  it('keeps the other side’s file when only it added the file (UA)', () => {
    expect(conflictRowActions('UA', labels).choices).toEqual([
      { label: 'Keep the file', side: 'theirs' },
      { label: 'Delete the file', side: 'ours' }
    ])
  })
})

describe('conflictRowActions — nothing to keep', () => {
  it('offers no keep choices when both sides deleted the file (DD)', () => {
    const actions = conflictRowActions('DD', labels)

    expect(actions.choices).toEqual([])
    expect(actions.note).toBe('Both sides deleted this file. Stage it to mark it resolved.')
  })

  it('offers no keep choices when the porcelain code is unknown', () => {
    const actions = conflictRowActions(undefined, labels)

    expect(actions.choices).toEqual([])
    expect(actions.note).toBe('Stage this file to mark it resolved.')
  })
})

describe('conflictRowActions — wording', () => {
  it('never writes the words “ours” or “theirs” into a label', () => {
    for (const code of ['UU', 'AA', 'DU', 'UD', 'AU', 'UA', 'DD']) {
      const actions = conflictRowActions(code, labels)
      const text = [...actions.choices.map((choice) => choice.label), actions.note ?? ''].join(' ')
      expect(text.toLowerCase()).not.toContain('ours')
      expect(text.toLowerCase()).not.toContain('theirs')
    }
  })
})
