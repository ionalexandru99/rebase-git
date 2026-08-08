import type {
  GitIdentity,
  IdentityField,
  IdentityScope,
  ResolvedIdentity
} from '@shared/schemas/git'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsNav } from './SettingsNav'
import { SettingsSearch } from './SettingsSearch'
import { type SettingsSearchEntry, searchSettingsIndex } from './search-index'
import { settingsSections } from './sections'

const REVEAL_HIGHLIGHT_MS = 1600

export interface SettingsViewProps {
  repoLabel: string | null
  initialSectionId?: string | null
  identity: ResolvedIdentity
  saving: boolean
  error: string | null
  onSave: (scope: IdentityScope, identity: GitIdentity) => void
  onClear: (fields: IdentityField[]) => void
  onClose: () => void
}

export function SettingsView(props: SettingsViewProps) {
  const [activeSectionId, setActiveSectionId] = useState(
    () =>
      settingsSections.find((section) => section.id === props.initialSectionId)?.id ??
      settingsSections[0].id
  )
  const activeSection =
    settingsSections.find((section) => section.id === activeSectionId) ?? settingsSections[0]

  const [searchQuery, setSearchQuery] = useState('')
  const [revealTarget, setRevealTarget] = useState<{ rowId: string } | null>(null)
  const searchResults = useMemo(() => searchSettingsIndex(searchQuery), [searchQuery])
  const searching = searchQuery.trim().length > 0

  const revealSearchResult = (entry: SettingsSearchEntry): void => {
    setSearchQuery('')
    setActiveSectionId(entry.sectionId)
    setRevealTarget({ rowId: entry.rowId })
  }

  useEffect(() => {
    if (revealTarget === null) {
      return
    }
    const row = document.querySelector(`[data-settings-row="${revealTarget.rowId}"]`)
    if (row === null) {
      return
    }
    if (typeof row.scrollIntoView === 'function') {
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      row.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' })
    }
    row.setAttribute('data-settings-row-highlight', 'true')
    const highlightTimer = window.setTimeout(() => {
      row.removeAttribute('data-settings-row-highlight')
    }, REVEAL_HIGHLIGHT_MS)
    return () => {
      window.clearTimeout(highlightTimer)
      row.removeAttribute('data-settings-row-highlight')
    }
  }, [revealTarget])

  return (
    <div data-testid="settings-view" className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center justify-between border-b px-6 py-4">
        <h2 className="text-sm font-semibold">Settings</h2>
        <Button type="button" variant="outline" size="sm" onClick={props.onClose}>
          Close settings
        </Button>
      </header>

      {props.error ? (
        <p
          data-testid="settings-error"
          className="border-b bg-destructive/10 px-6 py-3 text-xs text-destructive"
        >
          {props.error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex w-44 shrink-0 flex-col gap-3 overflow-y-auto border-r p-3">
          <SettingsSearch
            query={searchQuery}
            results={searchResults}
            onQueryChange={setSearchQuery}
            onReveal={revealSearchResult}
          />
          {searching ? null : (
            <SettingsNav
              sections={settingsSections}
              activeSectionId={activeSection.id}
              onSelect={setActiveSectionId}
            />
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <activeSection.Content
            repoLabel={props.repoLabel}
            identity={{
              resolved: props.identity,
              saving: props.saving,
              save: props.onSave,
              clear: props.onClear
            }}
          />
        </div>
      </div>
    </div>
  )
}
