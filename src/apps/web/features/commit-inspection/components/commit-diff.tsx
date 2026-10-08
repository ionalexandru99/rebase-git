import { useRef } from "react";
import type { CommitFile } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import type { DiffPreferences } from "#web/domain/file-diff/diff-preferences.contract.ts";
import { DiffContent } from "#web/features/file-diff/components/diff-content.tsx";
import { DiffDisplayControls } from "#web/features/file-diff/components/diff-display-controls.tsx";
import {
  contentUnchanged,
  createChangeDiffModel,
} from "#web/features/file-diff/diff-model.ts";
import type { DiffRead } from "#web/features/file-diff/hooks/use-diff-read.ts";

export default function CommitDiff({
  file,
  diff,
  preferences,
  choosePreferences,
  preview,
  focus,
}: {
  readonly focus?: { readonly start: number; readonly end: number } | undefined;
  readonly file: CommitFile | undefined;
  readonly diff: DiffRead;
  readonly preferences: DiffPreferences;
  readonly choosePreferences: (preferences: DiffPreferences) => void;
  readonly preview: boolean;
}) {
  const region = useRef<HTMLElement>(null);
  const value = diff.value ?? null;
  const previousPath = preview ? null : (file?.previousPath ?? null);
  const { metadata, hasHiddenContext } = createChangeDiffModel(
    value,
    previousPath,
  );
  return (
    <section
      className="flex min-h-0 min-w-0 flex-col"
      aria-label="Commit file diff"
      aria-busy={diff.loading}
      ref={region}
    >
      <DiffDisplayControls
        expanded={diff.expanded}
        onExpand={hasHiddenContext ? diff.expand : undefined}
        preferences={preferences}
        onPreferences={choosePreferences}
        region={region}
      />
      {preview ? (
        <p className="shrink-0 border-border border-b px-3 py-1.5 text-meta text-muted-foreground">
          Working tree after restore
        </p>
      ) : null}
      {file && (!metadata || (value !== null && contentUnchanged(value))) ? (
        <div className="shrink-0 break-all border-border border-b px-3 py-2 font-mono text-meta">
          {previousPath ? `${previousPath} → ` : ""}
          {file.path}
        </div>
      ) : null}
      {diff.error ? (
        <div role="alert" className="p-3 text-body">
          {diff.error}{" "}
          <Button size="xs" variant="ghost" onClick={diff.retry}>
            Retry
          </Button>
        </div>
      ) : value ? (
        preview && contentUnchanged(value) ? (
          <p className="p-4 text-body text-muted-foreground">
            The working tree already has this version.
          </p>
        ) : file?.status === "R" && contentUnchanged(value) ? (
          <p className="p-4 text-body text-muted-foreground">
            Content unchanged.
          </p>
        ) : (
          <DiffContent
            diff={value}
            metadata={metadata}
            preferences={preferences}
            expandContext={diff.expanded}
            loadWhole={diff.loadWhole}
            focus={focus}
          />
        )
      ) : (
        <p role="status" className="p-4 text-body text-muted-foreground">
          {diff.loading ? "Loading diff…" : "Select a file"}
        </p>
      )}
    </section>
  );
}
