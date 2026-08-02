import { FolderIcon } from 'lucide-react'
import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { DialogOverlay } from '@/components/ui/prompt-dialog'

export interface CloneRepoDialogViewProps {
  url: string
  parentDir: string | null
  folderName: string | null
  urlLooksValid: boolean
  canSubmit: boolean
  cloning: boolean
  error: string | null
  progress: { phase: string; percent?: number } | null
  onUrlChange: (url: string) => void
  onChooseParentDir: () => void
  onSubmit: () => void
  onCancel: () => void
  onDismiss: () => void
}

function destinationSeparator(parentDir: string): string {
  return parentDir.includes('\\') && !parentDir.includes('/') ? '\\' : '/'
}

export function CloneRepoDialogView(props: CloneRepoDialogViewProps) {
  const urlFieldId = useId()

  return (
    <DialogOverlay onDismiss={props.onDismiss} panelClassName="max-w-md">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          props.onSubmit()
        }}
      >
        <h2 className="text-sm font-semibold">Clone a repository</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          HTTPS or SSH. Rebase authenticates with your system credential helper and SSH agent.
        </p>

        <label htmlFor={urlFieldId} className="mt-4 block text-xs text-muted-foreground">
          Repository URL
        </label>
        <input
          id={urlFieldId}
          value={props.url}
          onChange={(event) => props.onUrlChange(event.target.value)}
          disabled={props.cloning}
          placeholder="https://github.com/owner/repo.git"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          className="mt-1 h-9 w-full rounded-[var(--r-sm)] border bg-background px-2.5 text-sm outline-none focus:border-border-strong disabled:opacity-60"
          // biome-ignore lint/a11y/noAutofocus: the URL is the only thing this dialog exists to collect
          autoFocus
        />

        <div className="mt-3 text-xs text-muted-foreground">Destination</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="flex min-w-0 flex-1 rounded-[var(--r-sm)] border bg-background px-2.5 py-2 text-sm">
            {props.parentDir ? (
              <>
                <span className="truncate text-muted-foreground">
                  {props.parentDir.replace(/[/\\]+$/, '')}
                </span>
                {props.folderName ? (
                  <span className="shrink-0 font-medium">{`${destinationSeparator(props.parentDir)}${props.folderName}`}</span>
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">Choose a folder to clone into</span>
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onChooseParentDir}
            disabled={props.cloning}
          >
            <FolderIcon />
            Change…
          </Button>
        </div>

        <div className="mt-2 min-h-8 text-xs">
          {!props.urlLooksValid ? (
            <p className="text-destructive">
              Enter an HTTPS or SSH repository URL, for example https://github.com/owner/repo.git
            </p>
          ) : props.error ? (
            <p
              data-testid="clone-error"
              className="whitespace-pre-wrap break-words text-destructive"
            >
              {props.error}
            </p>
          ) : props.progress ? (
            <CloneProgressBar phase={props.progress.phase} percent={props.progress.percent} />
          ) : null}
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!props.canSubmit}>
            {props.cloning ? 'Cloning…' : 'Clone'}
          </Button>
        </div>
      </form>
    </DialogOverlay>
  )
}

function CloneProgressBar(props: { phase: string; percent?: number }) {
  return (
    <div aria-live="polite" data-testid="clone-progress">
      <div className="flex items-baseline justify-between text-muted-foreground">
        <span>{props.phase}</span>
        {props.percent !== undefined ? <span>{props.percent}%</span> : null}
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-brand transition-[width]"
          style={{ width: `${props.percent ?? 0}%` }}
        />
      </div>
    </div>
  )
}
