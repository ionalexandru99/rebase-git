import type {
  GitIdentity,
  IdentityField,
  IdentityScope,
  ResolvedIdentity
} from '@shared/schemas/git'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'

export interface SettingsViewProps {
  repoLabel: string | null
  identity: ResolvedIdentity
  saving: boolean
  error: string | null
  onSave: (scope: IdentityScope, identity: GitIdentity) => void
  onClear: (fields: IdentityField[]) => void
  onClose: () => void
}

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

interface IdentitySectionProps {
  title: string
  description: string
  values: GitIdentity
  placeholders: GitIdentity
  saving: boolean
  blankPolicy: 'reject' | 'inherit'
  onSave: (form: IdentityForm) => void
  onClear: ((field: IdentityField) => void) | null
}

function IdentitySection(props: IdentitySectionProps) {
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
    <section aria-label={props.title} className="border-b px-6 py-5 last:border-b-0">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{props.description}</p>

      <form
        className="mt-4 grid gap-3"
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
    </section>
  )
}

export function SettingsView(props: SettingsViewProps) {
  return (
    <div data-testid="settings-view" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
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

      <IdentitySection
        key={`app:${formKey(props.identity.global)}`}
        title="App settings"
        description="The git identity Rebase uses for every repository unless a repository overrides it."
        values={props.identity.global}
        placeholders={{}}
        saving={props.saving}
        blankPolicy="reject"
        onSave={(form) => props.onSave('global', { name: form.name, email: form.email })}
        onClear={null}
      />

      {props.repoLabel === null ? null : (
        <IdentitySection
          key={`repo:${formKey(props.identity.local)}`}
          title="Repository settings"
          description={`Overrides the app identity for ${props.repoLabel}.`}
          values={props.identity.local}
          placeholders={props.identity.global}
          saving={props.saving}
          blankPolicy="inherit"
          onSave={(form) => {
            const cleared = clearedFields(props.identity.local, form)
            if (cleared.length > 0) {
              props.onClear(cleared)
            }
            const overrides = filledFields(form)
            if (overrides.name !== undefined || overrides.email !== undefined) {
              props.onSave('local', overrides)
            }
          }}
          onClear={(field) => props.onClear([field])}
        />
      )}
    </div>
  )
}
