import type { Hunk, SelectedLineRange } from "@pierre/diffs";
import { IconCheck, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { DiffContent } from "#web/features/file-diff/components/diff-content.tsx";
import { DiffDisplayControls } from "#web/features/file-diff/components/diff-display-controls.tsx";
import { createChangeDiffModel } from "#web/features/file-diff/diff-model.ts";
import type {
  ChangeAction,
  WorkingChangesView,
} from "#web/features/working-changes/hooks/use-working-changes-view.ts";

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
  hunk,
  onHunk,
}: {
  readonly view: DiffView;
  readonly writable: boolean;
  readonly act: ChangeAction;
  readonly hunk: number | null;
  readonly onHunk: (index: number | null) => void;
}) {
  const { changes, selection, loading } = view;
  const diff = view.diff ?? null;
  const [expandContext, setExpandContext] = useState(false);
  const section = selection?.section === "staged" ? "staged" : "unstaged";
  const files = changes?.[section] ?? [];
  const index = files.findIndex((file) => file.path === selection?.path);
  const file = files[index];
  const previous = files[index - 1];
  const next = files[index + 1];
  const previousPath = file?.previousPath ?? null;
  const { metadata, hasHiddenContext } = createChangeDiffModel(
    diff,
    previousPath,
  );
  const hunks = useMemo(
    () =>
      metadata?.hunks.flatMap((content) => {
        const range = hunkRange(content);
        return range ? [{ range, lines: hunkLines(content) }] : [];
      }) ?? [],
    [metadata],
  );
  const current =
    hunk !== null && hunks.length > 0 ? Math.min(hunk, hunks.length - 1) : null;
  const [selected, setSelected] = useState<SelectedLineRange | null>(() =>
    current === null ? null : (hunks[current]?.range ?? null),
  );
  const container = useRef<HTMLElement | null>(null);
  const region = useRef<HTMLElement>(null);
  const pendingReveal = useRef(selected);
  const reveal = (range: SelectedLineRange) => {
    pendingReveal.current = revealRange(container.current, range)
      ? null
      : range;
  };
  const selectHunk = (index: number) => {
    const range = hunks[index]?.range;
    if (range === undefined) return;
    setSelected(range);
    onHunk(index);
    reveal(range);
  };
  const selectLines = (range: SelectedLineRange | null) => {
    setSelected(range);
    onHunk(null);
  };
  const lines = useMemo(
    () =>
      current !== null
        ? (hunks[current]?.lines ?? [])
        : metadata
          ? selectedDiffLines(metadata, selected)
          : [],
    [current, hunks, metadata, selected],
  );
  const action = section === "unstaged" ? "stage" : "unstage";
  const label = section === "unstaged" ? "Stage" : "Unstage";
  const disabled = !writable || view.busy || loading;
  const scope = current === null ? "lines" : "hunk";
  const actOnLines = (
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
      ref={region}
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
        region={region}
      >
        {hunks.length > 0 && !empty ? (
          <fieldset aria-label="Hunks" className="mr-1 flex items-center">
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Previous hunk"
              disabled={current === 0}
              onClick={() =>
                selectHunk(current === null ? hunks.length - 1 : current - 1)
              }
            >
              <IconChevronUp />
            </Button>
            <span className="px-1 text-meta tabular-nums text-muted-foreground">
              {current === null
                ? `${hunks.length} ${hunks.length === 1 ? "hunk" : "hunks"}`
                : `Hunk ${current + 1}/${hunks.length}`}
            </span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Next hunk"
              disabled={current === hunks.length - 1}
              onClick={() => selectHunk(current === null ? 0 : current + 1)}
            >
              <IconChevronDown />
            </Button>
          </fieldset>
        ) : null}
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
          <span className="mr-auto text-meta">
            {`${lines.length} ${lines.length === 1 ? "line" : "lines"} selected`}
          </span>
          <Button
            size="xs"
            variant="destructive"
            disabled={disabled}
            onClick={() => actOnLines("discard", lines)}
          >
            Discard {scope}
          </Button>
          <Button
            size="xs"
            variant="outline"
            disabled={disabled}
            onClick={() => actOnLines(action, lines)}
          >
            {label} {scope}
          </Button>
        </div>
      ) : null}
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <IconCheck className="size-8" />
          <span className="text-body">
            No {section} changes{selection ? " in this file" : ""}
          </span>
        </div>
      ) : diff === null ? (
        <div className="flex flex-1 items-center justify-center text-control text-muted-foreground">
          {loading || selection ? "Loading changes…" : "Select a file"}
        </div>
      ) : previousPath !== null &&
        diff.kind === "text" &&
        diff.before === diff.after ? (
        <>
          <div className="shrink-0 break-all border-border border-b px-3 py-2 font-mono text-meta">
            {previousPath} → {diff.path}
          </div>
          <p className="p-4 text-body text-muted-foreground">
            Content unchanged.
          </p>
        </>
      ) : (
        <DiffContent
          diff={diff}
          metadata={metadata}
          preferences={view.preferences}
          expandContext={expandContext}
          selection={{ range: selected, onChange: selectLines }}
          onRender={(rendered) => {
            container.current = rendered;
            if (pendingReveal.current) reveal(pendingReveal.current);
          }}
        />
      )}
    </section>
  );
}

function hunkRows(hunk: Pick<Hunk, "hunkContent">) {
  return hunk.hunkContent.flatMap((content) =>
    content.type === "change"
      ? [
          ...Array.from({ length: content.deletions }, (_, i) => ({
            old: content.deletionLineIndex + i + 1,
            next: 0,
            id: `-${content.deletionLineIndex + i + 1}`,
          })),
          ...Array.from({ length: content.additions }, (_, i) => ({
            old: 0,
            next: content.additionLineIndex + i + 1,
            id: `+${content.additionLineIndex + i + 1}`,
          })),
        ]
      : Array.from({ length: content.lines }, (_, i) => ({
          old: content.deletionLineIndex + i + 1,
          next: content.additionLineIndex + i + 1,
          id: "",
        })),
  );
}

export function hunkLines(hunk: Pick<Hunk, "hunkContent">) {
  return hunkRows(hunk).flatMap((row) => (row.id ? [row.id] : []));
}

export function hunkRange(
  hunk: Pick<Hunk, "hunkContent">,
): SelectedLineRange | null {
  const changes = hunk.hunkContent.flatMap((content) =>
    content.type === "change" ? [content] : [],
  );
  const first = changes[0];
  const last = changes.at(-1);
  if (!first || !last) return null;
  return {
    ...(first.deletions > 0
      ? { start: first.deletionLineIndex + 1, side: "deletions" }
      : { start: first.additionLineIndex + 1, side: "additions" }),
    ...(last.additions > 0
      ? { end: last.additionLineIndex + last.additions, endSide: "additions" }
      : { end: last.deletionLineIndex + last.deletions, endSide: "deletions" }),
  };
}

function revealRange(container: HTMLElement | null, range: SelectedLineRange) {
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

export function selectedDiffLines(
  diff: { readonly hunks: readonly Pick<Hunk, "hunkContent">[] },
  range: SelectedLineRange | null,
) {
  if (range === null) return [];
  const side = range.side ?? "additions";
  const endSide = range.endSide ?? side;
  const rows = diff.hunks.flatMap(hunkRows);
  if (side === endSide)
    return rows
      .filter(
        (row) =>
          row.id &&
          (side === "deletions" ? row.old : row.next) >=
            Math.min(range.start, range.end) &&
          (side === "deletions" ? row.old : row.next) <=
            Math.max(range.start, range.end),
      )
      .map((row) => row.id);
  const start = rows.findIndex(
    (row) => (side === "deletions" ? row.old : row.next) === range.start,
  );
  const end = rows.findIndex(
    (row) => (endSide === "deletions" ? row.old : row.next) === range.end,
  );
  return start < 0 || end < 0
    ? []
    : rows
        .slice(Math.min(start, end), Math.max(start, end) + 1)
        .flatMap((row) => (row.id ? [row.id] : []));
}
