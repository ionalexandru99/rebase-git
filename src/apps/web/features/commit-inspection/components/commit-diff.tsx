import type { ChangeDiff, CommitFile } from "@rebase/contracts";
import { useMemo, useState } from "react";
import { Button } from "#web/components/ui/button";
import type { DiffPreferences } from "#web/domain/file-diff/diff-preferences.contract";
import { DiffContent } from "#web/features/file-diff/components/diff-content";
import { DiffDisplayControls } from "#web/features/file-diff/components/diff-display-controls";
import { createChangeDiffModel } from "#web/features/file-diff/diff-model";

export interface CommitDiffRead {
  readonly value: ChangeDiff | undefined;
  readonly loading: boolean;
  readonly error: string | null;
  readonly retry: () => void;
}

export default function CommitDiff({
  files,
  path,
  select,
  diff,
  preferences,
  choosePreferences,
}: {
  readonly files: readonly CommitFile[];
  readonly path: string | null;
  readonly select: (path: string) => void;
  readonly diff: CommitDiffRead;
  readonly preferences: DiffPreferences;
  readonly choosePreferences: (preferences: DiffPreferences) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const index = files.findIndex((file) => file.path === path);
  const previous = files[index - 1];
  const next = files[index + 1];
  const file = files[index];
  const value = diff.value ?? null;
  const { metadata, hasHiddenContext } = useMemo(
    () => createChangeDiffModel(value, file?.previousPath ?? null),
    [value, file?.previousPath],
  );
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col"
      aria-label="Commit file diff"
      aria-busy={diff.loading}
    >
      <DiffDisplayControls
        expanded={expanded}
        onExpand={hasHiddenContext ? setExpanded : undefined}
        preferences={preferences}
        onPreferences={choosePreferences}
        previous={previous ? () => select(previous.path) : undefined}
        next={next ? () => select(next.path) : undefined}
      />
      {file && (!metadata || value?.before === value?.after) ? (
        <div className="shrink-0 break-all border-border border-b px-3 py-2 font-mono text-xs">
          {file.previousPath ? `${file.previousPath} → ` : ""}
          {file.path}
        </div>
      ) : null}
      {diff.error ? (
        <div role="alert" className="p-3 text-sm">
          {diff.error}{" "}
          <Button size="xs" variant="ghost" onClick={diff.retry}>
            Retry diff
          </Button>
        </div>
      ) : value ? (
        file?.status === "R" &&
        value.kind === "text" &&
        value.before === value.after ? (
          <p className="p-4 text-sm text-muted-foreground">
            File renamed. Content unchanged.
          </p>
        ) : (
          <DiffContent
            diff={value}
            metadata={metadata}
            preferences={preferences}
            expandContext={expanded}
          />
        )
      ) : (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          {diff.loading ? "Loading diff…" : "Select a file"}
        </p>
      )}
    </section>
  );
}
