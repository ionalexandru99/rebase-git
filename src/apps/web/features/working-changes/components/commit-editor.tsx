import { Button } from "#web-ui/components/ui/button";
import { Input } from "#web-ui/components/ui/input";
import { useWorkingChanges } from "#web-ui/features/working-changes/working-changes-provider";

export function CommitEditor({ writable }: { readonly writable: boolean }) {
  const { state, controller } = useWorkingChanges();
  const disabled = !writable || state.busy || state.loading;
  const count = state.changes?.staged.length ?? 0;
  return (
    <section
      className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto border-border border-t bg-background p-3"
      aria-label="Commit editor"
    >
      <Input
        aria-label="Commit subject"
        placeholder="Commit message"
        value={state.draft.subject}
        disabled={state.loading || state.busy}
        maxLength={2000}
        onChange={(event) =>
          controller.updateDraft({
            ...state.draft,
            subject: event.target.value,
          })
        }
      />
      <textarea
        aria-label="Commit description"
        placeholder="Description"
        className="min-h-16 w-full flex-1 resize-none rounded-md border border-input bg-input/20 p-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        value={state.draft.description}
        disabled={state.loading || state.busy}
        maxLength={28000}
        onChange={(event) =>
          controller.updateDraft({
            ...state.draft,
            description: event.target.value,
          })
        }
      />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="accent-primary"
            checked={state.amend}
            disabled={disabled || state.changes?.head == null}
            onChange={(event) => controller.amend(event.target.checked)}
          />
          Amend
        </label>
        <Button
          size="sm"
          disabled={
            disabled ||
            !state.draft.subject.trim() ||
            (!state.amend && count === 0)
          }
          onClick={controller.commit}
        >
          {state.busy
            ? "Working…"
            : state.amend
              ? "Amend commit"
              : `Commit ${count} ${count === 1 ? "file" : "files"}`}
        </Button>
      </div>
    </section>
  );
}
