import type { GitIdentity, IdentityScope } from '@shared/schemas/git'
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogOverlay } from '@/components/ui/prompt-dialog'

export interface MissingIdentityDialogProps {
  effective: GitIdentity
  saving: boolean
  error: string | null
  onSave: (scope: IdentityScope, identity: { name: string; email: string }) => void
  onDismiss: () => void
}

const SCOPES: { value: IdentityScope; label: string }[] = [
  { value: 'global', label: 'All repositories' },
  { value: 'local', label: 'Only this repository' }
]

const FIELD_CLASS =
  'h-9 w-full rounded-[var(--r-sm)] border bg-background px-2.5 text-sm outline-none focus:border-border-strong disabled:opacity-60'

export function MissingIdentityDialog(props: MissingIdentityDialogProps) {
  const nameId = useId()
  const emailId = useId()
  const scopeGroup = useId()
  const nameRef = useRef<HTMLInputElement | null>(null)
  const [name, setName] = useState(props.effective.name ?? '')
  const [email, setEmail] = useState(props.effective.email ?? '')
  const [scope, setScope] = useState<IdentityScope>('global')

  useEffect(() => {
    queueMicrotask(() => nameRef.current?.focus())
  }, [])

  const incomplete = name.trim().length === 0 || email.trim().length === 0

  return (
    <DialogOverlay onDismiss={props.onDismiss} panelClassName="max-w-md">
      <div data-testid="missing-identity-dialog">
        <h2 className="text-sm font-semibold">Tell git who you are before committing</h2>
        <p className="mt-2 text-xs text-muted-foreground">
          Git stamps every commit with a name and email, and it has neither for this repository.
        </p>

        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (!incomplete) {
              props.onSave(scope, { name, email })
            }
          }}
        >
          <div className="grid gap-1">
            <label htmlFor={nameId} className="text-xs text-muted-foreground">
              Name
            </label>
            <input
              id={nameId}
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ada Lovelace"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className={FIELD_CLASS}
            />
          </div>
          <div className="grid gap-1">
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

          <fieldset className="flex flex-wrap items-center gap-3 border-0 p-0">
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
            <p role="alert" className="text-xs text-destructive">
              {props.error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={props.onDismiss}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={incomplete || props.saving}>
              Save identity
            </Button>
          </div>
        </form>
      </div>
    </DialogOverlay>
  )
}
