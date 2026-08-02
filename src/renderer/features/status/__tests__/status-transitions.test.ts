import { describe, expect, it } from 'vitest'
import { makeGitStatus } from '../../../../test/builders'
import { applyStageToStatus, applyUnstageToStatus } from '../status-transitions'

describe('status transitions', () => {
  it('stages a modified file without duplicating it', () => {
    const status = makeGitStatus({
      modified: ['src/app.ts'],
      staged: ['src/other.ts'],
      files: [
        { path: 'src/app.ts', index: ' ', working_dir: 'M' },
        { path: 'src/other.ts', index: 'M', working_dir: ' ' }
      ]
    })

    const staged = applyStageToStatus(status, 'src/app.ts')

    expect(staged.modified).toEqual([])
    expect(staged.staged).toEqual(['src/other.ts', 'src/app.ts'])
    expect(staged.files).toEqual([
      { path: 'src/app.ts', index: 'M', working_dir: ' ' },
      { path: 'src/other.ts', index: 'M', working_dir: ' ' }
    ])
    expect(applyStageToStatus(staged, 'src/app.ts').staged).toEqual(['src/other.ts', 'src/app.ts'])
  })

  it('stages an untracked file as an added file', () => {
    const status = makeGitStatus({
      not_added: ['new.ts'],
      created: ['new.ts'],
      files: [{ path: 'new.ts', index: '?', working_dir: '?' }]
    })

    const staged = applyStageToStatus(status, 'new.ts')

    expect(staged.staged).toEqual(['new.ts'])
    expect(staged.not_added).toEqual([])
    expect(staged.created).toEqual([])
    expect(staged.files).toEqual([{ path: 'new.ts', index: 'A', working_dir: ' ' }])
  })

  it('unstages an added file back to untracked codes', () => {
    const status = makeGitStatus({
      staged: ['new.ts'],
      files: [{ path: 'new.ts', index: 'A', working_dir: ' ' }]
    })

    const unstaged = applyUnstageToStatus(status, 'new.ts')

    expect(unstaged.staged).toEqual([])
    expect(unstaged.modified).toEqual(['new.ts'])
    expect(unstaged.files).toEqual([{ path: 'new.ts', index: '?', working_dir: '?' }])
  })

  it('preserves unrelated status entries', () => {
    const status = makeGitStatus({
      staged: ['src/app.ts'],
      files: [
        { path: 'src/app.ts', index: 'M', working_dir: ' ' },
        { path: 'src/other.ts', index: ' ', working_dir: 'M' }
      ]
    })

    const unstaged = applyUnstageToStatus(status, 'src/app.ts')

    expect(unstaged.files?.[1]).toEqual({
      path: 'src/other.ts',
      index: ' ',
      working_dir: 'M'
    })
  })
})
