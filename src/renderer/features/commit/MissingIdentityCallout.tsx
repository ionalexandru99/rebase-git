import type { GitIdentity, IdentityScope } from '@shared/schemas/git'
import { AlertTriangleIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'

export interface MissingIdentityCalloutProps {
  effective: GitIdentity
  saving: boolean
  error: string | null
  onSave: (scope: IdentityScope, identity: { name: string; email: string }) => void
}

const SCOPES: { value: IdentityScope; label: string }[] = [
  { value: 'global', label: 'All repositories' },
  { value: 'local', label: 'Only this repository' }
]

const FIELD_CLASS =
  'h-8 w-full rounded-[var(--r-sm)] border bg-background px-2.5 text-sm outline-none focus:border-border-strong disabled:opacity-60'

export function MissingIdentityCallout(props: MissingIdentityCalloutProps) {
  const nameId = useId()
  const emailId = useId()
  const scopeGroup = useId()
  const [name, setName] = useState(props.effective.name ?? '')
  const [email, setEmail] = useState(props.effective.email ?? '')
  const [scope, setScope] = useState<IdentityScope>('global')

  const incomplete = name.trim().length === 0 || email.trim().length === 0

  return (
    <section
      aria-label="Git identity required"
      data-testid="missing-identity-callout"
      className="mb-2 rounded-[var(--r-sm)] border border-orange/40 bg-orange/10 px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <AlertTriangleIcon className="size-4 shrink-0 text-orange" />
        <p className="text-sm font-semibold">Tell git who you are before committing</p>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Git stamps every commit with a name and email, and it has neither for this repository.
      </p>

      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!incomplete) {
            props.onSave(scope, { name, email })
          }
        }}
      >
        <div className="grid min-w-[140px] flex-1 gap-1">
          <label htmlFor={nameId} className="text-xs text-muted-foreground">
            Name
          </label>
          <input
            id={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ada Lovelace"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className={FIELD_CLASS}
          />
        </div>
        <div className="grid min-w-[180px] flex-1 gap-1">
          <label htmlFor={emailId} className="text-xs text-muted-foreground">
            Email
          </label>
          <input
            id={emailId}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ada@example.com"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            className={FIELD_CLASS}
          />
        </div>
        <Button type="submit" size="sm" disabled={incomplete || props.saving}>
          Save identity
        </Button>
      </form>

      <fieldset className="mt-2 flex flex-wrap items-center gap-3 border-0 p-0">
        <legend className="sr-only">Save this identity for</legend>
        {SCOPES.map((option) => (
          <label
            key={option.value}
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <input
              type="radio"
              name={scopeGroup}
              value={option.value}
              checked={scope === option.value}
              onChange={() => setScope(option.value)}
              className="size-3.5 accent-[var(--brand)]"
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      {props.error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
    </section>
  )
}
