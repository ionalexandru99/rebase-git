import type { SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { ChangeDiff } from "@rebase/contracts";
import { IconFileDiff } from "@tabler/icons-react";
import type { CSSProperties } from "react";
import type { DiffPreferences } from "#web/domain/file-diff/diff-preferences.contract";
import type { createChangeDiffModel } from "#web/features/file-diff/diff-model";

export function DiffContent({
  diff,
  metadata,
  preferences,
  expandContext,
  selection,
}: {
  readonly diff: ChangeDiff;
  readonly metadata: ReturnType<typeof createChangeDiffModel>["metadata"];
  readonly preferences: DiffPreferences;
  readonly expandContext: boolean;
  readonly selection?: {
    readonly range: SelectedLineRange | null;
    readonly onChange: (range: SelectedLineRange | null) => void;
  };
}) {
  return metadata ? (
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
        selectedLines={selection?.range ?? null}
        options={{
          theme: "pierre-dark",
          diffStyle: preferences.split ? "split" : "unified",
          overflow: preferences.wrap ? "wrap" : "scroll",
          expandUnchanged: expandContext,
          enableLineSelection: selection !== undefined,
          ...(selection === undefined
            ? {}
            : { onLineSelectionEnd: selection.onChange }),
        }}
      />
    </div>
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
                : "This diff could not be displayed."
              : `${diff.kind === "binary" ? "Binary file" : diff.kind === "symlink" ? "Symbolic link" : "Submodule"} changed.`}
      </p>
      <p className="text-xs">
        {diff.beforeBytes.toLocaleString()} → {diff.afterBytes.toLocaleString()}{" "}
        bytes
      </p>
    </div>
  );
}
