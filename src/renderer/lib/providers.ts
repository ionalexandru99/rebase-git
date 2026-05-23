export type Provider =
  | 'github'
  | 'gitlab'
  | 'azure'
  | 'bitbucket'
  | 'codeberg'
  | 'gitea'
  | 'sourcehut'

export function parseRemoteHost(url: string | undefined): string | null {
  if (!url) return null
  const sshMatch = url.match(/^[\w._-]+@([\w.-]+):/)
  if (sshMatch) return sshMatch[1].toLowerCase()
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function detectProvider(url: string | undefined): Provider | null {
  const host = parseRemoteHost(url)
  if (!host) return null
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github'
  if (host === 'gitlab.com' || host.includes('gitlab')) return 'gitlab'
  if (host === 'bitbucket.org' || host.includes('bitbucket')) return 'bitbucket'
  if (host === 'dev.azure.com' || host.endsWith('.visualstudio.com')) return 'azure'
  if (host === 'codeberg.org') return 'codeberg'
  if (host.endsWith('git.sr.ht') || host === 'sr.ht') return 'sourcehut'
  if (host.includes('gitea')) return 'gitea'
  return null
}
