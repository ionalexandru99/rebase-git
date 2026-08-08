import type { UpdateChannel, UpdaterStatus } from '@shared/schemas/ipc'

const SEMVER_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function prereleaseComponents(version: string): string[] | null {
  const match = SEMVER_PATTERN.exec(version.trim())
  if (match === null) {
    return null
  }
  const prerelease = match[4]
  return prerelease === undefined ? [] : prerelease.split('.')
}

export function deriveDefaultChannel(currentVersion: string): UpdateChannel {
  const prerelease = prereleaseComponents(currentVersion)
  if (prerelease === null) {
    return 'stable'
  }
  return prerelease[0] === 'nightly' ? 'nightly' : 'stable'
}

export function resolveUpdateChannel(
  stored: UpdateChannel | null,
  currentVersion: string
): UpdateChannel {
  return stored ?? deriveDefaultChannel(currentVersion)
}

export function versionBelongsToChannel(version: string, channel: UpdateChannel): boolean {
  const prerelease = prereleaseComponents(version)
  if (prerelease === null) {
    return false
  }
  if (channel === 'nightly') {
    return prerelease[0] === 'nightly'
  }
  return prerelease.length === 0
}

export interface UpdaterChannelProfile {
  channel: 'nightly' | null
  allowPrerelease: boolean
  allowDowngrade: boolean
}

export function updaterChannelProfile(
  channel: UpdateChannel,
  currentVersion: string
): UpdaterChannelProfile {
  if (channel === 'nightly') {
    return { channel: 'nightly', allowPrerelease: true, allowDowngrade: true }
  }
  const currentPrerelease = prereleaseComponents(currentVersion)
  return {
    channel: null,
    allowPrerelease: false,
    allowDowngrade: currentPrerelease !== null && currentPrerelease.length > 0
  }
}

export function describeChannelChangeBlocker(
  status: UpdaterStatus,
  installing: boolean
): string | null {
  if (installing) {
    return 'The update is installing right now.'
  }
  if (status === 'checking') {
    return 'A check for updates is running right now.'
  }
  if (status === 'downloading') {
    return 'An update is downloading right now.'
  }
  return null
}
