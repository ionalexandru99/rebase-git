import { describe, expect, it } from 'vitest'
import {
  classifyDiscardPaths,
  discardAllArgs,
  trackedDiscardArgs,
  untrackedDiscardArgs
} from '../discard-plan'

describe('discard plan', () => {
  it('separates tracked paths from porcelain-reported untracked paths', () => {
    const groups = classifyDiscardPaths(
      ['tracked.txt', 'new.txt', 'nested/new.txt'],
      ' M tracked.txt\0?? new.txt\0?? nested/new.txt\0'
    )

    expect(groups).toEqual({
      tracked: ['tracked.txt'],
      untracked: ['new.txt', 'nested/new.txt']
    })
  })

  it('treats staged additions and renames as tracked index entries', () => {
    const groups = classifyDiscardPaths(
      ['added.txt', 'renamed.txt'],
      'A  added.txt\0R  renamed.txt\0old.txt\0'
    )

    expect(groups).toEqual({ tracked: ['added.txt', 'renamed.txt'], untracked: [] })
  })

  it('restores tracked paths from HEAD in an established repository', () => {
    expect(trackedDiscardArgs(['*.txt', '--all'], true)).toEqual([
      'restore',
      '--source=HEAD',
      '--staged',
      '--worktree',
      '--',
      ':(literal)*.txt',
      ':(literal)--all'
    ])
  })

  it('removes tracked index entries in an unborn repository', () => {
    expect(trackedDiscardArgs(['first.txt'], false)).toEqual([
      'rm',
      '-rf',
      '--',
      ':(literal)first.txt'
    ])
  })

  it('cleans only the requested untracked paths', () => {
    expect(untrackedDiscardArgs(['new file.txt'])).toEqual([
      'clean',
      '-fd',
      '--',
      ':(literal)new file.txt'
    ])
  })

  it('resets tracked content before cleaning an established repository', () => {
    expect(discardAllArgs(true)).toEqual([
      ['reset', '--hard', 'HEAD'],
      ['clean', '-fd']
    ])
  })

  it('clears the unborn index before cleaning the working tree', () => {
    expect(discardAllArgs(false)).toEqual([
      ['rm', '-rf', '--cached', '--ignore-unmatch', '--', '.'],
      ['clean', '-fd']
    ])
  })
})
