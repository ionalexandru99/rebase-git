import { describe, expect, it, vi } from 'vitest'
import { installPlaywrightMcpElectronApiFromSearch } from '../install-from-url'

describe('installPlaywrightMcpElectronApiFromSearch', () => {
  it('maps all enabled URL fixture modes into the installed API options', () => {
    const install = vi.fn()

    installPlaywrightMcpElectronApiFromSearch('?onboarding=1&pagination=1&conflict=1', install)

    expect(install).toHaveBeenCalledWith({
      onboardingComplete: false,
      historyCount: 2_005,
      conflicted: true
    })
  })

  it('uses the default fixture options when URL modes are absent', () => {
    const install = vi.fn()

    installPlaywrightMcpElectronApiFromSearch('', install)

    expect(install).toHaveBeenCalledWith({
      onboardingComplete: true,
      historyCount: undefined,
      conflicted: false
    })
  })
})
