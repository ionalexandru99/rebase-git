import type { SelectedLineRange } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { IconFileDiff } from "@tabler/icons-react";
import { type CSSProperties, useRef } from "react";
import type { ChangeDiff } from "#contracts/repository-comparison/repository-comparison.contract.ts";
import type { DiffPreferences } from "#web/domain/file-diff/diff-preferences.contract.ts";
import type { createChangeDiffModel } from "#web/features/file-diff/diff-model.ts";
import { useTheme } from "#web/features/theme/theme.ts";

export const diffThemes = { dark: "pierre-dark", light: "pierre-light" };

export const diffSurfaceCSS =
  ":host { --diffs-bg: var(--repository); background-color: var(--repository); }";

export function DiffContent({
  diff,
  metadata,
  preferences,
  expandContext,
  loadWhole,
  selection,
  focus,
  onRender,
}: {
  readonly focus?: { readonly start: number; readonly end: number } | undefined;
  readonly diff: ChangeDiff;
  readonly metadata: ReturnType<typeof createChangeDiffModel>["metadata"];
  readonly preferences: DiffPreferences;
  readonly expandContext: boolean;
  readonly loadWhole?: (() => Promise<ChangeDiff>) | undefined;
  readonly selection?: {
    readonly range: SelectedLineRange | null;
    readonly onChange: (range: SelectedLineRange | null) => void;
  };
  readonly onRender?: (container: HTMLElement) => void;
}) {
  const theme = useTheme();
  const revealed = useRef<object>(undefined);
  const focused =
    focus === undefined ? null : { ...focus, side: "additions" as const };
  const rendered = (container: HTMLElement) => {
    if (
      focused !== null &&
      revealed.current !== focus &&
      revealRange(container, focused)
    )
      revealed.current = focus;
    onRender?.(container);
  };
  return metadata ? (
    <div className="min-h-0 flex-1 overflow-auto">
      <FileDiff
        style={
          {
            "--diffs-font-family": "var(--font-mono)",
            "--diffs-font-size": "var(--text-meta)",
            "--diffs-line-height": "20px",
          } as CSSProperties
        }
        fileDiff={metadata}
        selectedLines={selection?.range ?? focused}
        options={{
          theme: diffThemes,
          themeType: theme,
          unsafeCSS: diffSurfaceCSS,
          diffStyle: preferences.split ? "split" : "unified",
          overflow: preferences.wrap ? "wrap" : "scroll",
          expandUnchanged: expandContext && !metadata.isPartial,
          expansionLineCount: 10,
          ...(loadWhole === undefined
            ? {}
            : { loadDiffFiles: async () => wholeFiles(await loadWhole()) }),
          enableLineSelection: selection !== undefined,
          ...(selection === undefined
            ? {}
            : { onLineSelectionEnd: selection.onChange }),
          onPostRender: (container, _instance, phase) => {
            if (phase !== "unmount") rendered(container);
          },
        }}
      />
    </div>
  ) : diff.kind === "image" ? (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-auto p-3">
      {(["before", "after"] as const).map((side) => (
        <figure key={side} className="min-w-0">
          <figcaption className="mb-2 text-meta text-muted-foreground">
            {side === "before" ? "Before" : "After"}
          </figcaption>
          {diff[side] ? (
            <img
              alt={`${side} ${diff.path}`}
              src={`data:${diff.mime};base64,${diff[side]}`}
              className="max-w-full object-contain"
            />
          ) : (
            <p className="text-meta text-muted-foreground">No file</p>
          )}
        </figure>
      ))}
    </div>
  ) : (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center text-muted-foreground">
      <IconFileDiff className="size-8" />
      <p className="text-body">
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
      {diff.beforeBytes === diff.afterBytes ? null : (
        <p className="text-meta">
          {diff.beforeBytes.toLocaleString()} →{" "}
          {diff.afterBytes.toLocaleString()} bytes
        </p>
      )}
    </div>
  );
}

export function revealRange(
  container: HTMLElement | null,
  range: SelectedLineRange,
) {
  const row = (line: number, side: SelectedLineRange["side"]) =>
    container?.shadowRoot?.querySelector(
      `[data-line="${line}"][data-line-type="${side === "deletions" ? "change-deletion" : "change-addition"}"]`,
    );
  const first = row(range.start, range.side);
  if (!first) return false;
  row(range.end, range.endSide ?? range.side)?.scrollIntoView({
    block: "nearest",
  });
  first.scrollIntoView({ block: "nearest" });
  return true;
}

function wholeFiles({ path, before, after }: ChangeDiff) {
  return {
    oldFile: { name: path, contents: before ?? "" },
    newFile: { name: path, contents: after ?? "" },
  };
}
