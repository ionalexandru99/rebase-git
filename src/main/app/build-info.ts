import type { BuildInfo } from '@shared/schemas/ipc'

export interface BuildEnvironment {
  version: string
  commitSha: string
  electronVersion: string | undefined
  platform: string
  arch: string
}

export function describeBuildInfo(environment: BuildEnvironment): BuildInfo {
  return {
    version: environment.version,
    commitSha: environment.commitSha,
    electronVersion: environment.electronVersion ?? 'unknown',
    platformArch: `${environment.platform}-${environment.arch}`
  }
}

export function releaseNotesUrl(version: string): string {
  return `https://github.com/ionalexandru99/rebase-git/releases/tag/v${version}`
}
