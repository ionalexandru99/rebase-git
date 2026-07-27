import { deriveCloneFolderName, isSupportedCloneUrl } from '@shared/clone-url'
import { FolderIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DialogOverlay } from '@/components/ui/prompt-dialog'
import { useCloneRepo } from './useCloneRepo'

interface CloneRepoDialogProps {
  defaultParentDir: string | null
  onSelectParentDir: () => Promise<string | null>
  onCloned: (repoPath: string) => void
  onClose: () => void
}

function destinationSeparator(parentDir: string): string {
  return parentDir.includes('\\') && !parentDir.includes('/') ? '\\' : '/'
}

export function CloneRepoDialog(props: CloneRepoDialogProps) {
  const urlFieldId = useId()
  const [url, setUrl] = useState('')
  const [parentDir, setParentDir] = useState<string | null>(props.defaultParentDir)
  const clone = useCloneRepo()

  const trimmedUrl = url.trim()
  const folderName = deriveCloneFolderName(trimmedUrl)
  const urlLooksValid = trimmedUrl.length === 0 || isSupportedCloneUrl(trimmedUrl)
  const canSubmit =
    !clone.cloning && trimmedUrl.length > 0 && urlLooksValid && folderName !== null && !!parentDir

  const chooseParentDir = async () => {
    const chosen = await props.onSelectParentDir()
    if (chosen) {
      setParentDir(chosen)
    }
  }

  const submit = async () => {
    if (!canSubmit || !parentDir || !folderName) {
      return
    }
    const repoPath = await clone.clone({ url: trimmedUrl, parentDir, folderName })
    if (repoPath) {
      props.onCloned(repoPath)
    }
  }

  const dismiss = () => {
    if (clone.cloning) {
      return
    }
    props.onClose()
  }

  return (
    <DialogOverlay onDismiss={dismiss} panelClassName="max-w-md">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <h2 className="text-sm font-semibold">Clone a repository</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Rebase uses your system credential helper and SSH agent to authenticate.
        </p>

        <label htmlFor={urlFieldId} className="mt-4 block text-xs text-muted-foreground">
          Repository URL
        </label>
        <input
          id={urlFieldId}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            clone.reset()
          }}
          disabled={clone.cloning}
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
          {/* The folder about to be created is the part worth reading, so the parent path is the
              side that gets truncated. */}
          <span className="flex min-w-0 flex-1 rounded-[var(--r-sm)] border bg-background px-2.5 py-2 text-sm">
            {parentDir ? (
              <>
                <span className="truncate text-muted-foreground">
                  {parentDir.replace(/[/\\]+$/, '')}
                </span>
                {folderName && (
                  <span className="shrink-0 font-medium">{`${destinationSeparator(parentDir)}${folderName}`}</span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">Choose a folder to clone into</span>
            )}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void chooseParentDir()}
            disabled={clone.cloning}
          >
            <FolderIcon />
            Change…
          </Button>
        </div>

        <div className="mt-2 min-h-8 text-xs">
          {!urlLooksValid ? (
            <p className="text-destructive">
              Enter an HTTPS or SSH repository URL, for example https://github.com/owner/repo.git
            </p>
          ) : clone.error ? (
            <p className="whitespace-pre-wrap break-words text-destructive">{clone.error}</p>
          ) : clone.progress ? (
            <CloneProgressBar phase={clone.progress.phase} percent={clone.progress.percent} />
          ) : null}
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => (clone.cloning ? clone.cancel() : props.onClose())}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {clone.cloning ? 'Cloning…' : 'Clone'}
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
        {props.percent !== undefined && <span>{props.percent}%</span>}
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
