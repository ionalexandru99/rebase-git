import path from 'node:path'

export type ProfileLauncher = 'electron' | 'npx'
export type ProfileChannel = 'stable' | 'nightly'

export interface ProfileIdentity {
  readonly name: string
  readonly directory: string
  readonly isolated: boolean
  readonly isolationId: string | null
  readonly launcher: ProfileLauncher
  readonly channel: ProfileChannel
}

export interface SelectProfileOptions {
  readonly profilesRoot: string
  readonly launcher: ProfileLauncher
  readonly channel: ProfileChannel
  readonly explicitProfile?: string
}

const profileNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/

export function defaultProfileName(launcher: ProfileLauncher, channel: ProfileChannel): string {
  return `${launcher}-${channel}`
}

export function selectProfile(options: SelectProfileOptions): ProfileIdentity {
  const name = options.explicitProfile ?? defaultProfileName(options.launcher, options.channel)
  if (!profileNamePattern.test(name)) {
    throw new Error(`Invalid profile name ${JSON.stringify(name)}`)
  }
  return {
    name,
    directory: path.join(options.profilesRoot, name),
    isolated: false,
    isolationId: null,
    launcher: options.launcher,
    channel: options.channel
  }
}

export function selectIsolatedProfile(
  profile: ProfileIdentity,
  isolationId: string
): ProfileIdentity {
  if (!profileNamePattern.test(isolationId)) {
    throw new Error(`Invalid profile isolation ID ${JSON.stringify(isolationId)}`)
  }
  const name = `${profile.name}.instance-${isolationId}`
  return {
    ...profile,
    name,
    directory: path.join(path.dirname(profile.directory), name),
    isolated: true,
    isolationId
  }
}
