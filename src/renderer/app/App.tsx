import type { PersistedTabs } from '@shared/schemas/ipc'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { PortalContainerProvider } from '../components/ui/portal-container'
import { Toaster } from '../components/ui/sonner'
import { OnboardingScreen } from '../features/onboarding/OnboardingScreen'
import { useOnboarding } from '../features/onboarding/useOnboarding'
import { useTabs } from '../hooks/useTabs'
import { RepoRail } from '../shell/RepoRail'
import { Titlebar } from '../shell/Titlebar'
import { ErrorBoundary } from './ErrorBoundary'
import type { WorkspaceCatalog } from './NewTab'
import { TabView } from './TabView'

export default function App() {
  const onboarding = useOnboarding()
  const [persistedTabs, setPersistedTabs] = useState<PersistedTabs | null>(null)
  const [onboardingRepoPath, setOnboardingRepoPath] = useState<string | null>(null)

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
            setOnboardingRepoPath(path)
            setPersistedTabs({ tabs: [path], activeIndex: 0 })
            await onboarding.completeOnboarding()
          } catch (error) {
            console.error('[onboarding] openRepo failed', { path, error })
          }
        }}
      />
    )
  }

  return (
    <TabsShell
      persisted={
        onboardingRepoPath ? { tabs: [onboardingRepoPath], activeIndex: 0 } : persistedTabs
      }
      onboarding={onboarding}
    />
  )
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
    cancelRepoOpen,
    persistedSnapshot
  } = useTabs(props.persisted)
  const [recentRepos, setRecentRepos] = useState<string[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const rescanWorkspace = props.onboarding.rescanWorkingDirectory
  const refreshCatalog = useCallback(async () => {
    const [recent] = await Promise.all([
      window.electronAPI.getRecentRepos().catch((error: unknown) => {
        console.error('[app] failed to refresh recent repos', error)
        return null
      }),
      rescanWorkspace().catch((error: unknown) => {
        console.error('[app] failed to rescan the workspace', error)
      })
    ])
    if (recent) {
      setRecentRepos(recent)
    }
  }, [rescanWorkspace])

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
      removeWorkspace: props.onboarding.removeWorkspace,
      refresh: refreshCatalog
    }),
    [
      refreshCatalog,
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

      <div className="grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)]">
        <RepoRail
          tabs={loadedTabDescriptors}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onNew={newTab}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((open) => !open)}
        />

        <div className="relative flex min-h-0 flex-col overflow-hidden">
          {tabs.map((tab) => {
            const tabActive = tab.id === activeTabId
            const tabLoaded = tabActive || activatedTabIds.has(tab.id)
            return (
              <TabOwner key={tab.id} active={tabActive}>
                {tabLoaded ? (
                  <ErrorBoundary scope="tab">
                    <TabView
                      tab={tab}
                      tabActive={tabActive}
                      settingsOpen={settingsOpen}
                      onCloseSettings={() => setSettingsOpen(false)}
                      catalog={workspaceCatalog}
                      onOpenRepo={openRepoInTab}
                      onRepoOpened={confirmRepoOpen}
                      onRepoOpenFailed={cancelRepoOpen}
                    />
                  </ErrorBoundary>
                ) : null}
              </TabOwner>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TabOwner(props: { active: boolean; children: ReactNode }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  return (
    <div
      ref={setContainer}
      data-testid="tab-owner"
      data-active={props.active}
      className={
        props.active
          ? 'flex h-full min-h-0 flex-col'
          : 'pointer-events-none invisible absolute inset-0 flex min-h-0 flex-col'
      }
      aria-hidden={!props.active}
    >
      <PortalContainerProvider container={container}>{props.children}</PortalContainerProvider>
    </div>
  )
}
