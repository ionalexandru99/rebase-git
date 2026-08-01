import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RefBadge } from '../RefBadge'

const REMOTES = { origin: 'https://github.com/acme/app.git' }

describe('RefBadge', () => {
  it('draws the provider mark inline so it inherits the pill colour', () => {
    const { container } = render(
      <RefBadge parsedRef={{ label: 'origin/main', kind: 'remote' }} remotes={REMOTES} />
    )

    expect(container.querySelector('img')).toBeNull()
    const icon = container.querySelector('svg')
    expect(icon?.getAttribute('fill')).toBe('currentColor')
    expect(icon?.getAttribute('class')).toContain('!size-3.5')
  })

  it('tints each branch by its own name so two badges on one commit differ', () => {
    const first = render(
      <RefBadge parsedRef={{ label: 'main', kind: 'branch' }} remotes={REMOTES} />
    )
    const second = render(
      <RefBadge
        parsedRef={{ label: 't3code/implement-issue-165', kind: 'branch' }}
        remotes={REMOTES}
      />
    )

    const colorOf = (host: HTMLElement) =>
      (host.querySelector('[title]') as HTMLElement | null)?.style.color
    expect(colorOf(first.container)).toBeTruthy()
    expect(colorOf(first.container)).not.toBe(colorOf(second.container))
  })

  it('tints a remote branch like its local counterpart', () => {
    const local = render(
      <RefBadge parsedRef={{ label: 'main', kind: 'branch' }} remotes={REMOTES} />
    )
    const remote = render(
      <RefBadge parsedRef={{ label: 'origin/main', kind: 'remote' }} remotes={REMOTES} />
    )

    const colorOf = (host: HTMLElement) =>
      (host.querySelector('[title]') as HTMLElement | null)?.style.color
    expect(colorOf(local.container)).toBeTruthy()
    expect(colorOf(local.container)).toBe(colorOf(remote.container))
  })
})
