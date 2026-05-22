import { useEffect, useState } from 'react'
import { OnboardingScreen } from '@/components/OnboardingScreen'
import { TabBar } from '@/components/TabBar'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useTabs } from '@/hooks/useTabs'
import { TabView } from '@/TabView'

function App() {
  const onboarding = useOnboarding()
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    tabDescriptors,
    newTab,
    closeTab,
    reportTabRepo,
    requestOpenRepo
  } = useTabs()
  const [recentRepos, setRecentRepos] = useState<string[]>([])

  useEffect(() => {
    window.electronAPI.getRecentRepos().then(setRecentRepos)
  }, [])

  if (onboarding.onboardingComplete === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background text-foreground">
        <div className="animate-pulse text-xs text-muted-foreground">Loading...</div>
      </div>
    )
  }

  if (!onboarding.onboardingComplete) {
    return (
      <OnboardingScreen
        workingDirectory={onboarding.workingDirectory}
        discoveredRepos={onboarding.discoveredRepos}
        loading={onboarding.loading}
        error={onboarding.error}
        onSelectDirectory={onboarding.addWorkspace}
        onComplete={onboarding.completeOnboarding}
        onOpenRepo={async (path) => {
          await onboarding.completeOnboarding()
          try {
            await window.electronAPI.openRepo(path)
          } catch (error) {
            console.error('[onboarding] openRepo failed', { path, error })
          }
        }}
      />
    )
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <TabBar
        tabs={tabDescriptors}
        activeTabId={activeTabId}
        onSelect={setActiveTabId}
        onClose={closeTab}
        onNew={newTab}
      />

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={
              tab.id === activeTabId
                ? 'flex min-h-0 flex-1 flex-col'
                : 'pointer-events-none invisible absolute inset-0 flex min-h-0 flex-col'
            }
            aria-hidden={tab.id !== activeTabId}
          >
            <TabView
              tabId={tab.id}
              recentRepos={recentRepos}
              discoveredRepos={onboarding.discoveredRepos}
              workspaces={onboarding.workspaces}
              activeWorkspace={onboarding.activeWorkspace}
              onSwitchWorkspace={onboarding.switchWorkspace}
              onAddWorkspace={onboarding.addWorkspace}
              onRemoveWorkspace={onboarding.removeWorkspace}
              onReportRepo={reportTabRepo}
              onRequestOpenRepo={requestOpenRepo}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
