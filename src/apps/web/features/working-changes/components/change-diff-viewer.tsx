import type { SelectedLineRange } from "@pierre/diffs";
import { IconCheck } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import {
  createChangeDiffModel,
  DiffContent,
} from "#web/features/file-diff/index";
import { selectedDiffLines } from "#web/features/working-changes/diff/diff-selection";
import { Button } from "#web-ui/components/ui/button";
import type { ChangeAction } from "#web-ui/features/working-changes/components/change-file-tree";
import { DiffDisplayControls } from "#web-ui/features/working-changes/components/diff-display-controls";
import { useWorkingChanges } from "#web-ui/features/working-changes/working-changes-provider";

export default function ChangeDiffViewer({
  writable,
  act,
}: {
  readonly writable: boolean;
  readonly act: ChangeAction;
}) {
  const diff = useWorkingChanges("diff");
  const selection = useWorkingChanges("selection");
  const changes = useWorkingChanges("changes");
  const preferences = useWorkingChanges("preferences");
  const busy = useWorkingChanges("busy");
  const loading = useWorkingChanges("loading");
  const [selected, setSelected] = useState<SelectedLineRange | null>(null);
  const [expandContext, setExpandContext] = useState(false);
  const section = selection?.section ?? "unstaged";
  const file = selection
    ? changes?.[section].find((file) => file.path === selection.path)
    : undefined;
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
  const disabled = !writable || busy || loading;
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
  const empty = changes !== null && file === undefined;
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      aria-label="File diff"
    >
      <DiffDisplayControls
        expanded={expandContext}
        onExpand={!empty && hasHiddenContext ? setExpandContext : undefined}
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
          preferences={preferences}
          expandContext={expandContext}
          selection={{ range: selected, onChange: setSelected }}
        />
      )}
    </section>
  );
}
