// Auth is system-only: Rebase never prompts, so a failure means the machine's own Git setup needs
// fixing. The renderer names a topic, main resolves it here — the renderer can never hand an
// arbitrary URL to shell.openExternal.
export const HELP_LINKS = {
  'git-credentials': 'https://git-scm.com/docs/gitcredentials',
  'ssh-keys': 'https://git-scm.com/book/en/v2/Git-on-the-Server-Generating-Your-SSH-Public-Key',
  'ssh-known-hosts': 'https://man.openbsd.org/ssh#VERIFYING_HOST_KEYS'
} as const

export type HelpTopic = keyof typeof HELP_LINKS

export function isHelpTopic(value: unknown): value is HelpTopic {
  return typeof value === 'string' && Object.hasOwn(HELP_LINKS, value)
}

export const HELP_TOPIC_LABELS: Record<HelpTopic, string> = {
  'git-credentials': 'Set up a credential helper',
  'ssh-keys': 'Set up SSH keys',
  'ssh-known-hosts': 'How to verify host keys'
}
