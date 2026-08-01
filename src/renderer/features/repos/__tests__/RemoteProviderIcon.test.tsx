import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RemoteProviderIcon } from '../RemoteProviderIcon'

const PROVIDER_URLS = {
  github: 'https://github.com/acme/app.git',
  gitlab: 'https://gitlab.com/acme/app.git',
  azure: 'https://dev.azure.com/acme/app/_git/app',
  bitbucket: 'https://bitbucket.org/acme/app.git',
  codeberg: 'https://codeberg.org/acme/app.git',
  gitea: 'https://gitea.example.com/acme/app.git',
  sourcehut: 'https://git.sr.ht/~acme/app'
} as const

function fillAttributes(root: SVGElement): string[] {
  return Array.from(root.querySelectorAll('[fill]'))
    .map((element) => element.getAttribute('fill'))
    .filter((fill): fill is string => fill !== null)
}

describe('RemoteProviderIcon', () => {
  it('renders codeberg as an inline svg tinted with currentColor', () => {
    const { container } = render(<RemoteProviderIcon url={PROVIDER_URLS.codeberg} />)

    expect(container.querySelector('img')).toBeNull()
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('fill')).toBe('currentColor')
  })

  it('renders github flattened to a single-color silhouette', () => {
    const { container } = render(<RemoteProviderIcon url={PROVIDER_URLS.github} />)

    expect(container.querySelector('img')).toBeNull()
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('fill')).toBe('currentColor')
    expect(svg?.querySelector('linearGradient')).toBeNull()
    expect(fillAttributes(svg as SVGElement)).toEqual([])
  })

  it.each(Object.entries(PROVIDER_URLS))('draws %s with no hardcoded colours', (_provider, url) => {
    const { container } = render(<RemoteProviderIcon url={url} />)

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('fill')).toBe('currentColor')
    expect(svg?.getAttribute('viewBox')).toBeTruthy()
    expect(svg?.querySelectorAll('path').length).toBeGreaterThan(0)
    expect(fillAttributes(svg as SVGElement)).toEqual([])
    expect(svg?.querySelector('stop')).toBeNull()
  })

  it('exposes the provider name to assistive tech', () => {
    render(<RemoteProviderIcon url={PROVIDER_URLS.github} />)

    expect(screen.getByRole('img', { name: 'GitHub' })).toBeInTheDocument()
  })

  it('keeps the className contract so callers can size it', () => {
    const { container } = render(
      <RemoteProviderIcon url={PROVIDER_URLS.gitlab} className="!size-3.5" />
    )

    expect(container.querySelector('svg')?.getAttribute('class')).toContain('!size-3.5')
  })

  it('falls back to a generic cloud mark for unknown hosts', () => {
    render(<RemoteProviderIcon url="https://git.example.com/acme/app.git" />)

    expect(screen.getByLabelText('remote')).toBeInTheDocument()
  })
})
