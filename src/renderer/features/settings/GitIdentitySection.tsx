import type { GitIdentity, IdentityField } from '@shared/schemas/git'
import { UserIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { SettingsRow } from './SettingsRow'
import { SettingsSection } from './SettingsSection'
import type { SettingsSectionContentProps, SettingsSectionEntry } from './sections'

interface IdentityForm {
  name: string
  email: string
}

const FIELD_LABELS: Record<IdentityField, string> = { name: 'Name', email: 'Email' }

const toForm = (identity: GitIdentity): IdentityForm => ({
  name: identity.name ?? '',
  email: identity.email ?? ''
})

const formKey = (identity: GitIdentity): string => `${identity.name ?? ''} ${identity.email ?? ''}`

const filledFields = (form: IdentityForm): GitIdentity => ({
  ...(form.name.trim().length > 0 ? { name: form.name } : {}),
  ...(form.email.trim().length > 0 ? { email: form.email } : {})
})

const blankFields = (form: IdentityForm): IdentityField[] => {
  const fields: IdentityField[] = []
  if (form.name.trim().length === 0) {
    fields.push('name')
  }
  if (form.email.trim().length === 0) {
    fields.push('email')
  }
  return fields
}

const clearedFields = (local: GitIdentity, form: IdentityForm): IdentityField[] =>
  blankFields(form).filter((field) => local[field] !== undefined)

interface IdentityFieldRowProps {
  field: IdentityField
  value: string
  placeholder: string
  overridden: boolean
  rejectedMessageId: string | null
  onChange: (value: string) => void
  onClear: (() => void) | null
}

function IdentityFieldRow(props: IdentityFieldRowProps) {
  const inputId = useId()

  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between">
        <label htmlFor={inputId} className="text-xs text-muted-foreground">
          {FIELD_LABELS[props.field]}
        </label>
        {props.onClear && props.overridden ? (
          <button
            type="button"
            onClick={props.onClear}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Use app settings for {props.field}
          </button>
        ) : null}
      </div>
      <input
        id={inputId}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        aria-invalid={props.rejectedMessageId !== null}
        aria-describedby={props.rejectedMessageId ?? undefined}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className="h-9 w-full rounded-[var(--r-sm)] border bg-background px-2.5 text-sm outline-none focus:border-border-strong disabled:opacity-60"
      />
    </div>
  )
}

interface IdentityScopeRowProps {
  rowId: string
  title: string
  description: string
  values: GitIdentity
  placeholders: GitIdentity
  saving: boolean
  blankPolicy: 'reject' | 'inherit'
  onSave: (form: IdentityForm) => void
  onClear: ((field: IdentityField) => void) | null
}

function IdentityScopeRow(props: IdentityScopeRowProps) {
  const blankMessageId = useId()
  const [form, setForm] = useState(() => toForm(props.values))
  const [blankField, setBlankField] = useState<IdentityField | null>(null)

  const submit = () => {
    const blank = props.blankPolicy === 'reject' ? (blankFields(form)[0] ?? null) : null
    setBlankField(blank)
    if (blank === null) {
      props.onSave(form)
    }
  }

  return (
    <SettingsRow
      id={props.rowId}
      title={props.title}
      description={props.description}
      variant="stacked"
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <IdentityFieldRow
          field="name"
          value={form.name}
          placeholder={props.placeholders.name ?? ''}
          overridden={props.values.name !== undefined}
          rejectedMessageId={blankField === 'name' ? blankMessageId : null}
          onChange={(name) => setForm({ ...form, name })}
          onClear={props.onClear ? () => props.onClear?.('name') : null}
        />
        <IdentityFieldRow
          field="email"
          value={form.email}
          placeholder={props.placeholders.email ?? ''}
          overridden={props.values.email !== undefined}
          rejectedMessageId={blankField === 'email' ? blankMessageId : null}
          onChange={(email) => setForm({ ...form, email })}
          onClear={props.onClear ? () => props.onClear?.('email') : null}
        />

        <div className="flex items-center justify-between gap-3">
          {blankField ? (
            <p id={blankMessageId} role="alert" className="text-xs text-destructive">
              The {FIELD_LABELS[blankField].toLowerCase()} cannot be empty.
            </p>
          ) : (
            <span />
          )}
          <Button type="submit" size="sm" disabled={props.saving}>
            Save
          </Button>
        </div>
      </form>
    </SettingsRow>
  )
}

export function GitIdentityContent(props: SettingsSectionContentProps) {
  const identity = props.identity

  return (
    <SettingsSection
      icon={UserIcon}
      title="Git identity"
      description="Who your commits are recorded as."
    >
      <IdentityScopeRow
        key={`app:${formKey(identity.resolved.global)}`}
        rowId="settings-identity-app"
        title="App settings"
        description="The git identity Rebase uses for every repository unless a repository overrides it."
        values={identity.resolved.global}
        placeholders={{}}
        saving={identity.saving}
        blankPolicy="reject"
        onSave={(form) => identity.save('global', { name: form.name, email: form.email })}
        onClear={null}
      />

      {props.repoLabel === null ? null : (
        <IdentityScopeRow
          key={`repo:${formKey(identity.resolved.local)}`}
          rowId="settings-identity-repository"
          title="Repository settings"
          description={`Overrides the app identity for ${props.repoLabel}.`}
          values={identity.resolved.local}
          placeholders={identity.resolved.global}
          saving={identity.saving}
          blankPolicy="inherit"
          onSave={(form) => {
            const cleared = clearedFields(identity.resolved.local, form)
            if (cleared.length > 0) {
              identity.clear(cleared)
            }
            const overrides = filledFields(form)
            if (overrides.name !== undefined || overrides.email !== undefined) {
              identity.save('local', overrides)
            }
          }}
          onClear={(field) => identity.clear([field])}
        />
      )}
    </SettingsSection>
  )
}

export const gitIdentitySection: SettingsSectionEntry = {
  id: 'git-identity',
  label: 'Git identity',
  icon: UserIcon,
  Content: GitIdentityContent
}
