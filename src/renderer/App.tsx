import type { PersistedTabs } from '@shared/schemas/ipc'
import { useEffect, useMemo, useState } from 'react'
import { OnboardingScreen } from './components/OnboardingScreen'
import { RepoRail } from './components/shell/RepoRail'
import { Titlebar } from './components/shell/Titlebar'
import { Toaster } from './components/ui/sonner'
import { useOnboarding } from './hooks/useOnboarding'
import { useTabs } from './hooks/useTabs'
import type { WorkspaceCatalog } from './NewTab'
import { TabView } from './TabView'

export default function App() {
  const onboarding = useOnboarding()
  const [persistedTabs, setPersistedTabs] = useState<PersistedTabs | null>(null)

  useEffect(() => {
    window.electronAPI
      .getPersistedTabs()
      .then((state) => {
        setPersistedTabs({ tabs: [...state.tabs], activeIndex: state.activeIndex })
      })
      .catch((error: unknown) => {
        console.error('[app] failed to load persisted tabs', error)
        setPersistedTabs({ tabs: [null], activeIndex: 0 })
      })
  }, [])

  if (onboarding.onboardingComplete === null || persistedTabs === null) {
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
          try {
            await onboarding.completeOnboarding()
            await window.electronAPI.openRepo(path)
          } catch (error) {
            console.error('[onboarding] openRepo failed', { path, error })
          }
        }}
      />
    )
  }

  return <TabsShell persisted={persistedTabs} onboarding={onboarding} />
}

interface TabsShellProps {
  persisted: PersistedTabs
  onboarding: ReturnType<typeof useOnboarding>
}

function TabsShell(props: TabsShellProps) {
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    tabDescriptors,
    newTab,
    closeTab,
    openRepoInTab,
    confirmRepoOpen,
    persistedSnapshot
  } = useTabs(props.persisted)
  const [recentRepos, setRecentRepos] = useState<string[]>([])
  const [activatedTabIds, setActivatedTabIds] = useState<Set<string>>(new Set([activeTabId]))

  useEffect(() => {
    window.electronAPI
      .getRecentRepos()
      .then(setRecentRepos)
      .catch((error: unknown) => {
        console.error('[app] failed to load recent repos', error)
        setRecentRepos([])
      })
  }, [])

  useEffect(() => {
    window.electronAPI.setPersistedTabs(persistedSnapshot).catch((error: unknown) => {
      console.warn('[app] failed to persist tab state', error)
    })
  }, [persistedSnapshot])

  useEffect(() => {
    const id = activeTabId
    setActivatedTabIds((previous) => {
      if (previous.has(id)) {
        return previous
      }
      return new Set([...previous, id])
    })
  }, [activeTabId])

  const loadedTabDescriptors = useMemo(() => {
    const activated = activatedTabIds
    const active = activeTabId
    return tabDescriptors.map((tab) => ({
      ...tab,
      loaded: !tab.hasRepo || tab.id === active || activated.has(tab.id)
    }))
  }, [activatedTabIds, activeTabId, tabDescriptors])

  const workspaceCatalog = useMemo<WorkspaceCatalog>(
    () => ({
      recentRepos,
      discoveredRepos: props.onboarding.discoveredRepos,
      workspaces: props.onboarding.workspaces,
      activeWorkspace: props.onboarding.activeWorkspace,
      switchWorkspace: props.onboarding.switchWorkspace,
      addWorkspace: props.onboarding.addWorkspace,
      removeWorkspace: props.onboarding.removeWorkspace
    }),
    [
      recentRepos,
      props.onboarding.discoveredRepos,
      props.onboarding.workspaces,
      props.onboarding.activeWorkspace,
      props.onboarding.switchWorkspace,
      props.onboarding.addWorkspace,
      props.onboarding.removeWorkspace
    ]
  )

  return (
    <div className="flex h-screen flex-col bg-chrome text-foreground">
      <Toaster richColors position="bottom-right" />
      <Titlebar />

      <div className="grid min-h-0 flex-1 grid-cols-[64px_minmax(0,1fr)]">
        <RepoRail
          tabs={loadedTabDescriptors}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onNew={newTab}
        />

        <div className="relative flex min-h-0 flex-col overflow-hidden">
          {tabs.map((tab) => {
            const tabActive = tab.id === activeTabId
            const tabLoaded = tabActive || activatedTabIds.has(tab.id)
            return (
              <div
                key={tab.id}
                className={
                  tabActive
                    ? 'flex h-full min-h-0 flex-col'
                    : 'pointer-events-none invisible absolute inset-0 flex min-h-0 flex-col'
                }
                aria-hidden={!tabActive}
              >
                {tabLoaded ? (
                  <TabView
                    tab={tab}
                    tabActive={tabActive}
                    catalog={workspaceCatalog}
                    onOpenRepo={openRepoInTab}
                    onRepoOpened={confirmRepoOpen}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
