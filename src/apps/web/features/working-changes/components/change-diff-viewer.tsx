import type { SelectedLineRange } from "@pierre/diffs";
import { IconCheck } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Button } from "#web/components/ui/button";
import { DiffContent } from "#web/features/file-diff/components/diff-content";
import { DiffDisplayControls } from "#web/features/file-diff/components/diff-display-controls";
import { createChangeDiffModel } from "#web/features/file-diff/diff-model";
import { selectedDiffLines } from "#web/features/working-changes/diff/diff-selection";
import type {
  ChangeAction,
  WorkingChangesView,
} from "#web/features/working-changes/hooks/use-working-changes-view";

type DiffView = Pick<
  WorkingChangesView,
  | "changes"
  | "diff"
  | "selection"
  | "select"
  | "preferences"
  | "choosePreferences"
  | "busy"
  | "loading"
>;

export default function ChangeDiffViewer({
  view,
  writable,
  act,
}: {
  readonly view: DiffView;
  readonly writable: boolean;
  readonly act: ChangeAction;
}) {
  const { changes, selection, loading } = view;
  const diff = view.diff ?? null;
  const [selected, setSelected] = useState<SelectedLineRange | null>(null);
  const [expandContext, setExpandContext] = useState(false);
  const section = selection?.section ?? "unstaged";
  const files = changes?.[section] ?? [];
  const index = files.findIndex((file) => file.path === selection?.path);
  const file = files[index];
  const previous = files[index - 1];
  const next = files[index + 1];
  const previousPath = file?.previousPath ?? null;
  const { metadata, hasHiddenContext } = useMemo(
    () => createChangeDiffModel(diff, previousPath),
    [diff, previousPath],
  );
  const lines = useMemo(
    () => (metadata ? selectedDiffLines(metadata, selected) : []),
    [metadata, selected],
  );
  const action = section === "unstaged" ? "stage" : "unstage";
  const label = section === "unstaged" ? "Stage" : "Unstage";
  const disabled = !writable || view.busy || loading;
  const selectLines = (
    lineAction: "stage" | "unstage" | "discard",
    ids: readonly string[],
  ) => {
    if (diff)
      act(lineAction, section, {
        _tag: "Lines",
        path: diff.path,
        revision: diff.revision,
        lines: ids,
      });
  };
  const empty = changes !== undefined && file === undefined;
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      aria-label="File diff"
    >
      <DiffDisplayControls
        expanded={expandContext}
        onExpand={!empty && hasHiddenContext ? setExpandContext : undefined}
        preferences={view.preferences}
        onPreferences={view.choosePreferences}
        previous={
          previous
            ? () => view.select({ section, path: previous.path })
            : undefined
        }
        next={
          next ? () => view.select({ section, path: next.path }) : undefined
        }
      >
        {diff && !empty ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={disabled}
            aria-label={`${label} entire file`}
            onClick={() =>
              act(action, section, { _tag: "Files", paths: [diff.path] })
            }
          >
            {label} file
          </Button>
        ) : null}
      </DiffDisplayControls>
      {lines.length > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-border border-b bg-accent/40 px-3 py-1.5">
          <span className="mr-auto text-xs">
            {lines.length} changed {lines.length === 1 ? "line" : "lines"}{" "}
            selected
          </span>
          <Button
            size="xs"
            variant="destructive"
            disabled={disabled}
            onClick={() => selectLines("discard", lines)}
          >
            Discard lines
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => selectLines(action, lines)}
          >
            {label} lines
          </Button>
        </div>
      ) : null}
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <IconCheck className="size-8" />
          <span className="text-sm">
            No {section} changes{selection ? " in this file" : ""}
          </span>
        </div>
      ) : diff === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {loading || selection ? "Loading changes…" : "Select a file"}
        </div>
      ) : previousPath !== null &&
        diff.kind === "text" &&
        diff.before === diff.after ? (
        <>
          <div className="shrink-0 break-all border-border border-b px-3 py-2 font-mono text-xs">
            {previousPath} → {diff.path}
          </div>
          <p className="p-4 text-sm text-muted-foreground">
            File renamed. Content unchanged.
          </p>
        </>
      ) : (
        <DiffContent
          diff={diff}
          metadata={metadata}
          preferences={view.preferences}
          expandContext={expandContext}
          selection={{ range: selected, onChange: setSelected }}
        />
      )}
    </section>
  );
}
