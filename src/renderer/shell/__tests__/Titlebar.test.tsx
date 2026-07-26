import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Titlebar } from '../Titlebar'

const setPlatform = (platform: NodeJS.Platform) => {
  window.electronAPI.platform = platform
}

describe('Titlebar', () => {
  afterEach(() => {
    setPlatform('darwin')
  })

  it('renders a drag strip on macOS, where the native frame is hidden', () => {
    setPlatform('darwin')

    const { container } = render(<Titlebar />)

    expect(container.querySelector('header')).toHaveClass('drag-region')
  })

  it('renders nothing on platforms that keep their native title bar', () => {
    for (const platform of ['linux', 'win32'] as const) {
      setPlatform(platform)

      const { container } = render(<Titlebar />)

      expect(container).toBeEmptyDOMElement()
    }
  })
})
