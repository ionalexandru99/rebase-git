import { useMemo, useState } from "react";
import type { CommitInspectionState } from "#web/features/commit-inspection/commit-inspection.contract";
import type { CommitInspectionController } from "#web/features/commit-inspection/commit-inspection-controller";
import {
  createChangeDiffModel,
  DiffContent,
  DiffDisplayControls,
} from "#web/features/file-diff/index";
import { Button } from "#web-ui/components/ui/button";

export default function CommitDiff({
  state,
  controller,
}: {
  readonly state: CommitInspectionState;
  readonly controller: CommitInspectionController;
}) {
  const [expanded, setExpanded] = useState(false);
  const files = state.details?.files ?? [];
  const index = files.findIndex((file) => file.path === state.path);
  const previous = files[index - 1];
  const next = files[index + 1];
  const file = files[index];
  const { metadata, hasHiddenContext } = useMemo(
    () => createChangeDiffModel(state.diff, file?.previousPath ?? null),
    [state.diff, file?.previousPath],
  );
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col"
      aria-label="Commit file diff"
      aria-busy={state.loadingDiff}
    >
      <DiffDisplayControls
        expanded={expanded}
        onExpand={hasHiddenContext ? setExpanded : undefined}
        preferences={state.preferences}
        onPreferences={controller.preferences}
        previous={
          previous ? () => controller.selectFile(previous.path) : undefined
        }
        next={next ? () => controller.selectFile(next.path) : undefined}
      />
      {file && (!metadata || state.diff?.before === state.diff?.after) ? (
        <div className="shrink-0 break-all border-border border-b px-3 py-2 font-mono text-xs">
          {file.previousPath ? `${file.previousPath} → ` : ""}
          {file.path}
        </div>
      ) : null}
      {state.diffError ? (
        <div role="alert" className="p-3 text-sm">
          {state.diffError}{" "}
          <Button size="xs" variant="ghost" onClick={controller.retryDiff}>
            Retry diff
          </Button>
        </div>
      ) : state.diff ? (
        file?.status === "R" &&
        state.diff.kind === "text" &&
        state.diff.before === state.diff.after ? (
          <p className="p-4 text-sm text-muted-foreground">
            File renamed. Content unchanged.
          </p>
        ) : (
          <DiffContent
            diff={state.diff}
            metadata={metadata}
            preferences={state.preferences}
            expandContext={expanded}
          />
        )
      ) : (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          {state.loadingDiff ? "Loading diff…" : "Select a file"}
        </p>
      )}
    </section>
  );
}
