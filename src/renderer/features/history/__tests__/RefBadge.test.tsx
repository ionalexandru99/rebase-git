import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RefBadge } from '../RefBadge'

const REMOTES = { origin: 'https://github.com/acme/app.git' }

describe('RefBadge', () => {
  it('draws the provider mark inline so it inherits the pill colour', () => {
    const { container } = render(
      <RefBadge
        parsedRef={{ label: 'origin/main', kind: 'remote' }}
        laneHex="#4f9dff"
        remotes={REMOTES}
      />
    )

    expect(container.querySelector('img')).toBeNull()
    const icon = container.querySelector('svg')
    expect(icon?.getAttribute('fill')).toBe('currentColor')
    expect(icon?.getAttribute('class')).toContain('!size-3.5')
  })
})
