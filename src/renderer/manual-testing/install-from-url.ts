import {
  installPlaywrightMcpElectronApi,
  type PlaywrightMcpElectronApiOptions
} from './electron-api'

type InstallPlaywrightMcpElectronApi = (options: PlaywrightMcpElectronApiOptions) => void

export function installPlaywrightMcpElectronApiFromSearch(
  search: string,
  install: InstallPlaywrightMcpElectronApi = installPlaywrightMcpElectronApi
): void {
  const searchParams = new URLSearchParams(search)
  install({
    onboardingComplete: searchParams.get('onboarding') !== '1',
    historyCount: searchParams.get('pagination') === '1' ? 2_005 : undefined,
    conflicted: searchParams.get('conflict') === '1'
  })
}
