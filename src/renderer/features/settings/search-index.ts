export interface SettingsSearchEntry {
  sectionId: string
  sectionLabel: string
  rowId: string
  title: string
  description: string
  synonyms: string[]
  requiresOpenRepository?: boolean
}

export interface SettingsSearchContext {
  repositoryOpen: boolean
}

export const settingsSearchIndex: SettingsSearchEntry[] = [
  {
    sectionId: 'general',
    sectionLabel: 'General',
    rowId: 'settings-general-reopen-on-launch',
    title: 'Reopen repositories on launch',
    description:
      'Pick up where you left off: the repositories that were open when Rebase closed open again. When off, Rebase starts with a single blank tab.',
    synonyms: ['startup', 'restore', 'tabs', 'blank tab']
  },
  {
    sectionId: 'general',
    sectionLabel: 'General',
    rowId: 'settings-general-pull-diverged',
    title: 'When your branch and the remote have both moved on',
    description: 'How a pull finishes when you and the remote each have new commits.',
    synonyms: ['pull', 'diverged', 'rebase', 'merge', 'ask each time']
  },
  {
    sectionId: 'git-identity',
    sectionLabel: 'Git identity',
    rowId: 'settings-identity-app',
    title: 'App settings',
    description:
      'The git identity Rebase uses for every repository unless a repository overrides it.',
    synonyms: ['name', 'email', 'author', 'committer', 'user.name', 'user.email', 'global']
  },
  {
    sectionId: 'git-identity',
    sectionLabel: 'Git identity',
    rowId: 'settings-identity-repository',
    title: 'Repository settings',
    description: 'Overrides the app identity for the open repository.',
    synonyms: ['name', 'email', 'override', 'local', 'per-repository'],
    requiresOpenRepository: true
  },
  {
    sectionId: 'updates',
    sectionLabel: 'Updates',
    rowId: 'settings-updates-version',
    title: 'Version',
    description: 'The version you are running, with a check for newer releases.',
    synonyms: ['check for updates', 'download', 'install', 'upgrade', 'new version']
  },
  {
    sectionId: 'updates',
    sectionLabel: 'Updates',
    rowId: 'settings-updates-channel',
    title: 'Update channel',
    description:
      'Which releases Rebase follows: tested stable releases, or a fresh build of main every night.',
    synonyms: ['nightly', 'beta', 'prerelease', 'pre-release', 'stable', 'unstable', 'edge']
  },
  {
    sectionId: 'updates',
    sectionLabel: 'Updates',
    rowId: 'settings-updates-background-download',
    title: 'Download updates in the background',
    description:
      'New versions download as soon as Rebase finds them. When off, you press Download yourself.',
    synonyms: ['automatic download', 'auto update']
  },
  {
    sectionId: 'updates',
    sectionLabel: 'Updates',
    rowId: 'settings-updates-install-on-quit',
    title: 'Install when I quit',
    description: 'A downloaded update installs itself the next time Rebase closes.',
    synonyms: ['restart', 'quit', 'exit', 'automatic install']
  },
  {
    sectionId: 'about',
    sectionLabel: 'About',
    rowId: 'settings-about-build',
    title: 'Build',
    description: 'The exact build you are running — paste this into bug reports.',
    synonyms: ['version', 'commit', 'sha', 'electron', 'copy', 'bug report']
  },
  {
    sectionId: 'about',
    sectionLabel: 'About',
    rowId: 'settings-about-logs',
    title: 'Logs',
    description: 'Open the folder where Rebase writes its log files.',
    synonyms: ['log files', 'debug', 'troubleshoot', 'diagnostics']
  },
  {
    sectionId: 'about',
    sectionLabel: 'About',
    rowId: 'settings-about-release-notes',
    title: 'Release notes',
    description: 'What changed in this version, on the GitHub releases page.',
    synonyms: ['changelog', "what's new", 'github releases']
  }
]

export function searchSettingsIndex(
  query: string,
  context: SettingsSearchContext
): SettingsSearchEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) {
    return []
  }
  return settingsSearchIndex.filter((entry) => {
    if (entry.requiresOpenRepository && !context.repositoryOpen) {
      return false
    }
    return [entry.sectionLabel, entry.title, entry.description, ...entry.synonyms].some((text) =>
      text.toLowerCase().includes(needle)
    )
  })
}
