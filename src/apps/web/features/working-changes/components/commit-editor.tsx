import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { useWorktreeOperation } from "#web/features/operation-recovery/hooks/use-operation-status.ts";
import type { WorkingChangesView } from "#web/features/working-changes/hooks/use-working-changes-view.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";

type CommitEditorView = Pick<
  WorkingChangesView,
  | "changes"
  | "draft"
  | "editDraft"
  | "amend"
  | "toggleAmend"
  | "busy"
  | "loading"
  | "commit"
>;

export function CommitEditor({
  view,
  writable,
}: {
  readonly view: CommitEditorView;
  readonly writable: boolean;
}) {
  const { draft, busy, loading, amend, changes } = view;
  const recovery = useWorktreeOperation(usePanelFeature()?.scope);
  const operation = recovery?.operation;
  const editStop = operation?.kind === "rebase" && operation.phase === "edit";
  const blocked =
    recovery !== null &&
    (recovery.checking ||
      recovery.busy ||
      (operation?.kind !== "idle" && !editStop));
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
          view.editDraft({ ...draft, subject: event.target.value })
        }
      />
      <textarea
        aria-label="Commit description"
        placeholder="Description"
        className="min-h-16 w-full flex-1 resize-none rounded-control border border-input bg-input/20 p-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        value={draft.description}
        disabled={loading || busy}
        maxLength={28000}
        onChange={(event) =>
          view.editDraft({ ...draft, description: event.target.value })
        }
      />
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            className="accent-primary"
            checked={amend}
            disabled={
              amend
                ? !writable || busy
                : disabled || changes?.head == null || blocked
            }
            onChange={(event) => view.toggleAmend(event.target.checked)}
          />
          Amend
        </label>
        <Button
          size="sm"
          disabled={
            disabled ||
            blocked ||
            !draft.subject.trim() ||
            (!amend && count === 0)
          }
          onClick={view.commit}
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
