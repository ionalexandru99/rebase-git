import { Cloud } from 'lucide-react'
import azureSvg from '@/assets/providers/azure.svg?raw'
import bitbucketSvg from '@/assets/providers/bitbucket.svg?raw'
import codebergSvg from '@/assets/providers/codeberg.svg?raw'
import giteaSvg from '@/assets/providers/gitea.svg?raw'
import githubSvg from '@/assets/providers/github.svg?raw'
import gitlabSvg from '@/assets/providers/gitlab.svg?raw'
import sourcehutSvg from '@/assets/providers/sourcehut.svg?raw'
import { cn } from '@/lib/utils'

type Provider = 'github' | 'gitlab' | 'azure' | 'bitbucket' | 'codeberg' | 'gitea' | 'sourcehut'
type Style = 'color' | 'mono'

const PROVIDERS: Record<Provider, { svg: string; label: string; style: Style }> = {
  github: { svg: githubSvg, label: 'GitHub', style: 'color' },
  gitlab: { svg: gitlabSvg, label: 'GitLab', style: 'color' },
  azure: { svg: azureSvg, label: 'Azure DevOps', style: 'color' },
  bitbucket: { svg: bitbucketSvg, label: 'Bitbucket', style: 'mono' },
  codeberg: { svg: codebergSvg, label: 'Codeberg', style: 'mono' },
  gitea: { svg: giteaSvg, label: 'Gitea', style: 'mono' },
  sourcehut: { svg: sourcehutSvg, label: 'sourcehut', style: 'mono' }
}

export function parseRemoteHost(url: string | undefined): string | null {
  if (!url) return null
  const sshMatch = url.match(/^[\w._-]+@([\w.-]+):/)
  if (sshMatch) return sshMatch[1].toLowerCase()
  try {
    const u = new URL(url)
    return u.hostname.toLowerCase()
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

interface RemoteProviderIconProps {
  url: string | undefined
  className?: string
}

export function RemoteProviderIcon({ url, className }: RemoteProviderIconProps) {
  const provider = detectProvider(url)
  if (!provider) {
    return <Cloud aria-label="remote" className={cn('shrink-0', className)} />
  }
  const { svg, label, style } = PROVIDERS[provider]
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex shrink-0 [&_svg]:size-full',
        style === 'mono' && '[&_path]:fill-current',
        className
      )}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG imported as raw build-asset string, not user input
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
