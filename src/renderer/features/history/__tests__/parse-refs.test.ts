import { GIT_LOG_REF_SEPARATOR } from '@shared/schemas/git'
import { describe, expect, it } from 'vitest'
import { parseRefs } from '@/features/history/graph/refs'

describe('parseRefs', () => {
  it('keeps local and origin when both decorate the same commit', () => {
    const refs = parseRefs(`HEAD -> main${GIT_LOG_REF_SEPARATOR}origin/main`)
    expect(refs).toEqual([
      { label: 'main', kind: 'branch' },
      { label: 'origin/main', kind: 'remote' }
    ])
  })

  it('keeps origin/X when no matching local branch is present', () => {
    const refs = parseRefs('origin/feature')
    expect(refs).toEqual([{ label: 'origin/feature', kind: 'remote' }])
  })

  it('classifies stash entries', () => {
    const refs = parseRefs('stash@{0}')
    expect(refs).toEqual([{ label: 'stash@{0}', kind: 'stash' }])
  })

  it('drops origin/HEAD symref so it never renders as a pill', () => {
    const refs = parseRefs(
      `HEAD -> main${GIT_LOG_REF_SEPARATOR}origin/main${GIT_LOG_REF_SEPARATOR}origin/HEAD`,
      new Set(['origin'])
    )
    expect(refs).toEqual([
      { label: 'main', kind: 'branch' },
      { label: 'origin/main', kind: 'remote' }
    ])
  })
})
