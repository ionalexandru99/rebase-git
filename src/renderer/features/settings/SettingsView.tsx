import type {
  GitIdentity,
  IdentityField,
  IdentityScope,
  ResolvedIdentity
} from '@shared/schemas/git'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsNav } from './SettingsNav'
import { settingsSections } from './sections'

export interface SettingsViewProps {
  repoLabel: string | null
  identity: ResolvedIdentity
  saving: boolean
  error: string | null
  onSave: (scope: IdentityScope, identity: GitIdentity) => void
  onClear: (fields: IdentityField[]) => void
  onClose: () => void
}

export function SettingsView(props: SettingsViewProps) {
  const [activeSectionId, setActiveSectionId] = useState(settingsSections[0].id)
  const activeSection =
    settingsSections.find((section) => section.id === activeSectionId) ?? settingsSections[0]

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
        <SettingsNav
          sections={settingsSections}
          activeSectionId={activeSection.id}
          onSelect={setActiveSectionId}
        />
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
