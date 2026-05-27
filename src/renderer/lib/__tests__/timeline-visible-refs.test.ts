import { describe, expect, it } from 'vitest'
import { refFilterKey } from '@/components/HistoryPanel/selectors'
import {
  defaultVisibleTimelineRefs,
  effectiveVisibleTimelineRefs,
  resolveDefaultTimelineBranch,
  toggleVisibleTimelineRef
} from '../timeline-visible-refs'

const local = ['main', 'feature', 'develop']
const remotes = ['origin/main', 'origin/feature']

describe('resolveDefaultTimelineBranch', () => {
  it('prefers defaultBranch from the remote HEAD', () => {
    expect(resolveDefaultTimelineBranch(local, 'develop', 'feature')).toBe('develop')
  })
})

describe('defaultVisibleTimelineRefs', () => {
  it('seeds local main and its tracking remotes', () => {
    expect(defaultVisibleTimelineRefs(local, remotes, 'main')).toEqual(
      new Set([refFilterKey('local', 'main'), refFilterKey('remote', 'origin/main')])
    )
  })
})

describe('effectiveVisibleTimelineRefs', () => {
  it('returns the selected set when non-empty', () => {
    const selected = new Set([refFilterKey('local', 'feature')])
    expect(effectiveVisibleTimelineRefs(selected, local, remotes, 'main')).toBe(selected)
  })

  it('defaults to main and origin/main when nothing is selected', () => {
    const effective = effectiveVisibleTimelineRefs(new Set(), local, remotes, 'main')
    expect(effective).toEqual(
      new Set([refFilterKey('local', 'main'), refFilterKey('remote', 'origin/main')])
    )
  })
})

describe('toggleVisibleTimelineRef', () => {
  it('falls back to the default branch when toggling off the last selected branch', () => {
    const selected = new Set([
      refFilterKey('local', 'feature'),
      refFilterKey('remote', 'origin/feature')
    ])
    const next = toggleVisibleTimelineRef(
      selected,
      refFilterKey('local', 'feature'),
      local,
      remotes,
      'main'
    )
    expect(next).toEqual(
      new Set([refFilterKey('local', 'main'), refFilterKey('remote', 'origin/main')])
    )
  })

  it('removes a tracking remote when toggling off its selected local branch', () => {
    const selected = new Set([
      refFilterKey('local', 'main'),
      refFilterKey('remote', 'origin/main'),
      refFilterKey('local', 'feature')
    ])
    const next = toggleVisibleTimelineRef(
      selected,
      refFilterKey('local', 'main'),
      local,
      remotes,
      'main'
    )
    expect(next).toEqual(new Set([refFilterKey('local', 'feature')]))
  })

  it('adds tracking remotes when toggling on a local branch', () => {
    const next = toggleVisibleTimelineRef(
      new Set(),
      refFilterKey('local', 'feature'),
      local,
      remotes,
      'main'
    )
    expect(next).toEqual(
      new Set([refFilterKey('local', 'feature'), refFilterKey('remote', 'origin/feature')])
    )
  })
})
