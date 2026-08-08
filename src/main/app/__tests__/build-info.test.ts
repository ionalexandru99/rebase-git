import { describe, expect, it } from 'vitest'
import { describeBuildInfo, releaseNotesUrl } from '../build-info'

describe('describeBuildInfo', () => {
  it('returns the build metadata shape the renderer expects', () => {
    expect(
      describeBuildInfo({
        version: '1.2.3',
        commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
        electronVersion: '37.2.0',
        platform: 'darwin',
        arch: 'arm64'
      })
    ).toEqual({
      version: '1.2.3',
      commitSha: 'abcdef1234567890abcdef1234567890abcdef12',
      electronVersion: '37.2.0',
      platformArch: 'darwin-arm64'
    })
  })

  it('falls back when the Electron version is missing', () => {
    const info = describeBuildInfo({
      version: '1.2.3',
      commitSha: 'unknown',
      electronVersion: undefined,
      platform: 'linux',
      arch: 'x64'
    })

    expect(info.electronVersion).toBe('unknown')
    expect(info.platformArch).toBe('linux-x64')
  })
})

describe('releaseNotesUrl', () => {
  it('points at this version tag on the GitHub releases page', () => {
    expect(releaseNotesUrl('1.2.3')).toBe(
      'https://github.com/ionalexandru99/rebase-git/releases/tag/v1.2.3'
    )
  })
})
