import { CloudIcon } from 'lucide-react'
import azureSvg from '@/assets/providers/azure.svg?raw'
import bitbucketSvg from '@/assets/providers/bitbucket.svg?raw'
import codebergSvg from '@/assets/providers/codeberg.svg?raw'
import giteaSvg from '@/assets/providers/gitea.svg?raw'
import githubSvg from '@/assets/providers/github.svg?raw'
import gitlabSvg from '@/assets/providers/gitlab.svg?raw'
import sourcehutSvg from '@/assets/providers/sourcehut.svg?raw'
import { detectProvider, type Provider } from '@/lib/providers'
import { Show } from '@/lib/react-compat'
import { cn } from '@/lib/utils'

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

interface RemoteProviderIconProps {
  url: string | undefined
  className?: string
}

export function RemoteProviderIcon(props: RemoteProviderIconProps) {
  const provider = () => detectProvider(props.url)
  const entry = () => {
    const detected = provider()
    return detected ? PROVIDERS[detected] : null
  }
  return (
    <Show
      when={entry()}
      fallback={<CloudIcon aria-label="remote" className={cn('shrink-0', props.className)} />}
    >
      {(resolved) => (
        <img
          alt={resolved().label}
          title={resolved().label}
          className={cn(
            'inline-flex shrink-0 object-contain',
            resolved().style === 'mono' && 'text-current',
            props.className
          )}
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(resolved().svg)}`}
        />
      )}
    </Show>
  )
}
