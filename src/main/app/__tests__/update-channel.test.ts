import { describe, expect, it } from 'vitest'
import {
  deriveDefaultChannel,
  describeChannelChangeBlocker,
  resolveUpdateChannel,
  updaterChannelProfile,
  versionBelongsToChannel
} from '../update-channel'

describe('deriveDefaultChannel', () => {
  it('defaults a plain release version to stable', () => {
    expect(deriveDefaultChannel('1.2.3')).toBe('stable')
  })

  it('defaults a nightly version to nightly', () => {
    expect(deriveDefaultChannel('0.1.1-nightly.20260808.5')).toBe('nightly')
  })

  it('accepts a leading v on the version', () => {
    expect(deriveDefaultChannel('v0.1.1-nightly.20260808.5')).toBe('nightly')
  })

  it('defaults other prereleases to stable', () => {
    expect(deriveDefaultChannel('1.2.3-beta.1')).toBe('stable')
  })

  it('defaults malformed version strings to stable', () => {
    expect(deriveDefaultChannel('not-a-version')).toBe('stable')
    expect(deriveDefaultChannel('nightly')).toBe('stable')
    expect(deriveDefaultChannel('1.2')).toBe('stable')
    expect(deriveDefaultChannel('')).toBe('stable')
  })
})

describe('resolveUpdateChannel', () => {
  it('keeps the persisted channel over the derived default', () => {
    expect(resolveUpdateChannel('nightly', '1.2.3')).toBe('nightly')
    expect(resolveUpdateChannel('stable', '0.1.1-nightly.20260808.5')).toBe('stable')
  })

  it('derives the default when nothing is persisted', () => {
    expect(resolveUpdateChannel(null, '1.2.3')).toBe('stable')
    expect(resolveUpdateChannel(null, '0.1.1-nightly.20260808.5')).toBe('nightly')
  })
})

describe('updaterChannelProfile', () => {
  it('opts into prereleases and downgrades on nightly', () => {
    expect(updaterChannelProfile('nightly', '1.2.3')).toEqual({
      channel: 'nightly',
      allowPrerelease: true,
      allowDowngrade: true
    })
  })

  it('leaves the channel unset and locks out prereleases on stable', () => {
    expect(updaterChannelProfile('stable', '1.2.3')).toEqual({
      channel: null,
      allowPrerelease: false,
      allowDowngrade: false
    })
  })

  it('allows the downgrade back to stable when running a nightly build', () => {
    expect(updaterChannelProfile('stable', '0.2.0-nightly.20260807.3')).toEqual({
      channel: null,
      allowPrerelease: false,
      allowDowngrade: true
    })
  })
})

describe('versionBelongsToChannel', () => {
  it('accepts only nightly versions on the nightly channel', () => {
    expect(versionBelongsToChannel('0.1.1-nightly.20260808.5', 'nightly')).toBe(true)
    expect(versionBelongsToChannel('1.2.3', 'nightly')).toBe(false)
    expect(versionBelongsToChannel('1.2.3-beta.1', 'nightly')).toBe(false)
  })

  it('accepts only plain release versions on the stable channel', () => {
    expect(versionBelongsToChannel('1.2.3', 'stable')).toBe(true)
    expect(versionBelongsToChannel('0.1.1-nightly.20260808.5', 'stable')).toBe(false)
    expect(versionBelongsToChannel('1.2.3-beta.1', 'stable')).toBe(false)
  })

  it('rejects unparseable versions on both channels', () => {
    expect(versionBelongsToChannel('not-a-version', 'stable')).toBe(false)
    expect(versionBelongsToChannel('not-a-version', 'nightly')).toBe(false)
  })
})

describe('describeChannelChangeBlocker', () => {
  it('lets the channel change while nothing is running', () => {
    for (const status of ['idle', 'up-to-date', 'available', 'downloaded', 'error'] as const) {
      expect(describeChannelChangeBlocker(status, false)).toBeNull()
    }
  })

  it('names the check holding a change back', () => {
    expect(describeChannelChangeBlocker('checking', false)).toBe(
      'A check for updates is running right now.'
    )
  })

  it('names the download holding a change back', () => {
    expect(describeChannelChangeBlocker('downloading', false)).toBe(
      'An update is downloading right now.'
    )
  })

  it('names the install holding a change back', () => {
    expect(describeChannelChangeBlocker('downloaded', true)).toBe(
      'The update is installing right now.'
    )
  })
})
