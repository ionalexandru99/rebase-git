import { Button } from "#web-ui/components/ui/button";
import { Input } from "#web-ui/components/ui/input";
import {
  useCommitDraft,
  useWorkingChanges,
  useWorkingChangesController,
} from "#web-ui/features/working-changes/working-changes-provider";

export function CommitEditor({ writable }: { readonly writable: boolean }) {
  const controller = useWorkingChangesController();
  const draft = useCommitDraft();
  const busy = useWorkingChanges("busy");
  const loading = useWorkingChanges("loading");
  const amend = useWorkingChanges("amend");
  const changes = useWorkingChanges("changes");
  const disabled = !writable || busy || loading;
  const count = changes?.staged.length ?? 0;
  return (
    <section
      className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto border-border border-t bg-background p-3"
      aria-label="Commit editor"
    >
      <Input
        aria-label="Commit subject"
        placeholder="Commit message"
        value={draft.subject}
        disabled={loading || busy}
        maxLength={2000}
        onChange={(event) =>
          controller.updateDraft({ ...draft, subject: event.target.value })
        }
      />
      <textarea
        aria-label="Commit description"
        placeholder="Description"
        className="min-h-16 w-full flex-1 resize-none rounded-md border border-input bg-input/20 p-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        value={draft.description}
        disabled={loading || busy}
        maxLength={28000}
        onChange={(event) =>
          controller.updateDraft({ ...draft, description: event.target.value })
        }
      />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="accent-primary"
            checked={amend}
            disabled={disabled || changes?.head == null}
            onChange={(event) => controller.amend(event.target.checked)}
          />
          Amend
        </label>
        <Button
          size="sm"
          disabled={
            disabled || !draft.subject.trim() || (!amend && count === 0)
          }
          onClick={controller.commit}
        >
          {busy
            ? "Working…"
            : amend
              ? "Amend commit"
              : `Commit ${count} ${count === 1 ? "file" : "files"}`}
        </Button>
      </div>
    </section>
  );
}
