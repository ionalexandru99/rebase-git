import type { SelectedLineRange } from "@pierre/diffs";
import {
  FileDiff,
  WorkerPoolContextProvider,
  type WorkerPoolOptions,
} from "@pierre/diffs/react";
import DiffWorker from "@pierre/diffs/worker/worker.js?worker";
import { IconCheck, IconFileDiff } from "@tabler/icons-react";
import { type CSSProperties, useMemo, useState } from "react";
import { createChangeDiffModel } from "#web/features/working-changes/diff/change-diff-model";
import { selectedDiffLines } from "#web/features/working-changes/diff/diff-selection";
import { Button } from "#web-ui/components/ui/button";
import type { ChangeAction } from "#web-ui/features/working-changes/components/change-file-tree";
import { DiffDisplayControls } from "#web-ui/features/working-changes/components/diff-display-controls";
import { useWorkingChanges } from "#web-ui/features/working-changes/working-changes-provider";

const poolOptions: WorkerPoolOptions = {
  workerFactory: () => new DiffWorker(),
  poolSize: 2,
  totalASTLRUCacheSize: 8,
};
const highlighterOptions = {
  theme: "pierre-dark",
  langs: ["typescript", "tsx", "csharp", "json"] as const,
  tokenizeMaxLineLength: 5000,
};

export default function ChangeDiffViewer({
  writable,
  act,
}: {
  readonly writable: boolean;
  readonly act: ChangeAction;
}) {
  const { state } = useWorkingChanges();
  const [selected, setSelected] = useState<SelectedLineRange | null>(null);
  const [expandContext, setExpandContext] = useState(false);
  const diff = state.diff;
  const { metadata } = useMemo(() => createChangeDiffModel(diff), [diff]);
  const lines = useMemo(
    () => (metadata ? selectedDiffLines(metadata, selected) : []),
    [metadata, selected],
  );
  const selection = state.selection;
  const section = selection?.section ?? "unstaged";
  const action = section === "unstaged" ? "stage" : "unstage";
  const label = section === "unstaged" ? "Stage" : "Unstage";
  const disabled = !writable || state.busy || state.loading;
  const selectLines = (
    action: "stage" | "unstage" | "discard",
    ids: readonly string[],
  ) => {
    if (diff)
      act(action, section, {
        _tag: "Lines",
        path: diff.path,
        revision: diff.revision,
        lines: ids,
      });
  };
  const prefs = state.preferences;
  const empty =
    state.changes !== null &&
    (selection === null ||
      !state.changes[section].some((file) => file.path === selection.path));
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      aria-label="File diff"
    >
      <DiffDisplayControls expanded={expandContext} onExpand={setExpandContext}>
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
          {state.loading || selection ? "Loading changes…" : "Select a file"}
        </div>
      ) : metadata ? (
        <WorkerPoolContextProvider
          poolOptions={poolOptions}
          highlighterOptions={{
            ...highlighterOptions,
            langs: [...highlighterOptions.langs],
          }}
        >
          <div className="min-h-0 flex-1 overflow-auto">
            <FileDiff
              style={
                {
                  "--diffs-font-family": "var(--font-mono)",
                  "--diffs-font-size": "12px",
                  "--diffs-line-height": "20px",
                } as CSSProperties
              }
              fileDiff={metadata}
              selectedLines={selected}
              options={{
                theme: "pierre-dark",
                diffStyle: prefs.split ? "split" : "unified",
                overflow: prefs.wrap ? "wrap" : "scroll",
                expandUnchanged: expandContext,
                enableLineSelection: true,
                onLineSelectionEnd: setSelected,
              }}
            />
          </div>
        </WorkerPoolContextProvider>
      ) : diff.kind === "image" ? (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-auto p-3">
          {(["before", "after"] as const).map((side) => (
            <figure key={side} className="min-w-0">
              <figcaption className="mb-2 text-xs text-muted-foreground">
                {side === "before" ? "Before" : "After"}
              </figcaption>
              {diff[side] ? (
                <img
                  alt={`${side} ${diff.path}`}
                  src={`data:${diff.mime};base64,${diff[side]}`}
                  className="max-w-full object-contain"
                />
              ) : (
                <p className="text-xs text-muted-foreground">No file</p>
              )}
            </figure>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground">
          <IconFileDiff className="size-8" />
          <p className="text-sm">
            {diff.kind === "conflict"
              ? "Resolve this file's merge conflict before committing."
              : diff.kind === "large"
                ? "This file is too large for an inline preview."
                : diff.kind === "text"
                  ? diff.before === diff.after
                    ? "File metadata changed."
                    : "This diff could not be displayed. Whole-file actions are still available."
                  : `${diff.kind === "binary" ? "Binary file" : diff.kind === "symlink" ? "Symbolic link" : "Submodule"} changed.`}
          </p>
          <p className="text-xs">
            {diff.beforeBytes.toLocaleString()} →{" "}
            {diff.afterBytes.toLocaleString()} bytes
          </p>
        </div>
      )}
    </section>
  );
}
