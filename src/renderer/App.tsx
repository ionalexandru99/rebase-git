import type { PersistedTabs } from '@shared/schemas/ipc'
import { createEffect, createSignal, For, onMount, Show } from 'solid-js'
import { OnboardingScreen } from './components/OnboardingScreen'
import { TabBar } from './components/TabBar'
import { Toaster } from './components/ui/sonner'
import { useOnboarding } from './hooks/useOnboarding'
import { useTabs } from './hooks/useTabs'
import { TabView } from './TabView'

export default function App() {
  const onboarding = useOnboarding()
  const [persistedTabs, setPersistedTabs] = createSignal<PersistedTabs | null>(null)

  onMount(() => {
    window.electronAPI
      .getPersistedTabs()
      .then((state) => {
        setPersistedTabs({ tabs: [...state.tabs], activeIndex: state.activeIndex })
      })
      .catch((error: unknown) => {
        console.error('[app] failed to load persisted tabs', error)
        setPersistedTabs({ tabs: [null], activeIndex: 0 })
      })
  })

  return (
    <Show
      when={onboarding.onboardingComplete() !== null && persistedTabs() !== null}
      fallback={
        <div class="flex h-screen items-center justify-center bg-background text-foreground">
          <div class="animate-pulse text-xs text-muted-foreground">Loading...</div>
        </div>
      }
    >
      <Show
        when={onboarding.onboardingComplete()}
        fallback={
          <OnboardingScreen
            workingDirectory={onboarding.workingDirectory()}
            discoveredRepos={onboarding.discoveredRepos()}
            loading={onboarding.loading()}
            error={onboarding.error()}
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
        }
      >
        <TabsShell persisted={persistedTabs() as PersistedTabs} onboarding={onboarding} />
      </Show>
    </Show>
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
    reportTabRepo,
    requestOpenRepo,
    persistedSnapshot,
    initialRepoPath
  } = useTabs(props.persisted)
  const [recentRepos, setRecentRepos] = createSignal<string[]>([])

  onMount(() => {
    window.electronAPI
      .getRecentRepos()
      .then(setRecentRepos)
      .catch((error: unknown) => {
        console.error('[app] failed to load recent repos', error)
        setRecentRepos([])
      })
  })

  createEffect(() => {
    window.electronAPI.setPersistedTabs(persistedSnapshot()).catch((error: unknown) => {
      console.warn('[app] failed to persist tab state', error)
    })
  })

  return (
    <div class="flex h-screen flex-col bg-background text-foreground">
      <Toaster richColors position="bottom-right" />
      <TabBar
        tabs={tabDescriptors()}
        activeTabId={activeTabId()}
        onSelect={setActiveTabId}
        onClose={closeTab}
        onNew={newTab}
      />

      <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <For each={tabs()}>
          {(tab) => (
            <div
              class={
                tab.id === activeTabId()
                  ? 'flex min-h-0 flex-1 flex-col'
                  : 'pointer-events-none invisible absolute inset-0 flex min-h-0 flex-col'
              }
              aria-hidden={tab.id !== activeTabId()}
            >
              <TabView
                tabId={tab.id}
                tabActive={() => tab.id === activeTabId()}
                initialRepoPath={initialRepoPath(tab.id)}
                recentRepos={recentRepos()}
                discoveredRepos={props.onboarding.discoveredRepos()}
                workspaces={props.onboarding.workspaces()}
                activeWorkspace={props.onboarding.activeWorkspace()}
                onSwitchWorkspace={props.onboarding.switchWorkspace}
                onAddWorkspace={props.onboarding.addWorkspace}
                onRemoveWorkspace={props.onboarding.removeWorkspace}
                onReportRepo={reportTabRepo}
                onRequestOpenRepo={requestOpenRepo}
              />
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
