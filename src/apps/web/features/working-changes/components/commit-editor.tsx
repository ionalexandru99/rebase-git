import { IconCheck } from "@tabler/icons-react";
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
        className="min-h-12 w-full flex-1 resize-none rounded-control border border-input bg-field px-[calc(--spacing(3)-1px)] py-1.5 text-control text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        value={draft.description}
        disabled={loading || busy}
        maxLength={28000}
        onChange={(event) =>
          view.editDraft({ ...draft, description: event.target.value })
        }
      />
      <label className="flex items-center gap-2 py-1 text-control text-muted-foreground has-disabled:opacity-50">
        <span className="relative grid size-4 shrink-0 place-items-center">
          <input
            type="checkbox"
            className="peer size-4 appearance-none rounded-control border border-input bg-field outline-none checked:border-primary checked:bg-primary focus-visible:ring-2 focus-visible:ring-ring/30 dark:checked:bg-primary"
            checked={amend}
            disabled={
              amend
                ? !writable || busy
                : disabled || changes?.head == null || blocked
            }
            onChange={(event) => view.toggleAmend(event.target.checked)}
          />
          <IconCheck
            aria-hidden="true"
            className="pointer-events-none absolute size-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
            stroke={3}
          />
        </span>
        Amend last commit
      </label>
      <Button
        className="w-full shrink-0 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
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
    </section>
  );
}
