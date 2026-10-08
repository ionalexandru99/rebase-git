import { File } from "@pierre/diffs/react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useId,
  useState,
} from "react";
import type {
  BlameCommit,
  BlameRange,
} from "#contracts/file-blame/file-blame.contract.ts";
import {
  type Action,
  ActionMenuItems,
} from "#web/components/ui/action-menu.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import { copyCommitMenu } from "#web/features/clipboard/copy-commit-menu.ts";
import type { CommitInput } from "#web/features/commit-inspection/commit-input.ts";
import { RangeRow } from "#web/features/file-blame/range-row.tsx";
import {
  diffSurfaceCSS,
  diffThemes,
} from "#web/features/file-diff/components/diff-content.tsx";
import { openMenu } from "#web/features/file-history/file-history-list.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useTheme } from "#web/features/theme/theme.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";

export interface BlameHandlers {
  readonly onSelectCommit?: ((oid: string) => void) | undefined;
  readonly onOpenDetails?: ((input: CommitInput) => void) | undefined;
}

export function BlameLines({
  path,
  text,
  line,
  ranges,
  commits,
  onSelectCommit,
  onOpenDetails,
}: BlameHandlers & {
  readonly path: string;
  readonly text: string;
  readonly line: number | undefined;
  readonly ranges: readonly BlameRange[];
  readonly commits: readonly BlameCommit[];
}) {
  const theme = useTheme();
  const dispatch = usePanelFeature()?.dispatch;
  const errorToast = useErrorToast();
  const listId = useId();
  const [selectedLine, setSelectedLine] = useState(line);
  const found =
    selectedLine === undefined ? -1 : rangeContaining(ranges, selectedLine);
  const selected = found < 0 ? undefined : found;
  const commitsByOid = new Map(commits.map((commit) => [commit.oid, commit]));
  const commitOf = (range: BlameRange | undefined) =>
    range?.oid == null ? undefined : commitsByOid.get(range.oid);
  const rowId = (index: number) => `${listId}-${index}`;
  const active = selected === undefined ? undefined : ranges[selected];

  const select = (index: number) => {
    const range = ranges[index];
    if (range === undefined) return;
    setSelectedLine(range.start);
    if (range.oid !== null) onSelectCommit?.(range.oid);
    document.getElementById(rowId(index))?.scrollIntoView({ block: "nearest" });
  };
  const open = (range: BlameRange) => {
    const commit = commitOf(range);
    if (commit === undefined) dispatch?.({ type: "open", kind: "changes" });
    else
      onOpenDetails?.({
        oid: commit.oid,
        path: commit.path,
        lines: {
          start: range.originalLine,
          end: range.originalLine + range.count - 1,
        },
      });
  };
  const actionsFor = (range: BlameRange | undefined): readonly Action[] => {
    if (range === undefined) return [];
    const commit = commitOf(range);
    if (commit === undefined)
      return [
        {
          id: "openChanges",
          label: "Open in Diffs",
          enabled: dispatch !== undefined,
          run: () => open(range),
        },
      ];
    const previous = commit.previous;
    return [
      {
        id: "openCommit",
        label: "Open commit",
        enabled: onOpenDetails !== undefined,
        run: () => open(range),
      },
      {
        id: "blameBefore",
        label: "Blame before this commit",
        enabled: previous !== null && dispatch !== undefined,
        run: () => {
          if (previous !== null)
            dispatch?.({
              type: "open",
              kind: "blame",
              input: {
                _tag: "Blame",
                path: previous.path,
                revision: previous.oid,
                line: range.originalLine,
              },
            });
        },
      },
      copyCommitMenu(commit, errorToast),
    ];
  };

  const rangeAt = (event: MouseEvent<HTMLElement>) => {
    for (const target of event.nativeEvent.composedPath()) {
      if (!(target instanceof HTMLElement)) continue;
      const row = target.dataset.range;
      if (row !== undefined) return Number(row);
      const line = Number(
        target.getAttribute("data-line") ??
          target.getAttribute("data-column-number"),
      );
      if (line > 0) return rangeContaining(ranges, line);
    }
    return -1;
  };
  const onClick = (event: MouseEvent<HTMLElement>) => {
    const index = rangeAt(event);
    if (index >= 0 && index !== selected) select(index);
  };
  const onDoubleClick = (event: MouseEvent<HTMLElement>) => {
    const range = ranges[rangeAt(event)];
    if (range !== undefined) open(range);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = ranges.length - 1;
    if (event.key === "ArrowDown")
      select(selected === undefined ? 0 : Math.min(last, selected + 1));
    else if (event.key === "ArrowUp")
      select(selected === undefined ? 0 : Math.max(0, selected - 1));
    else if (event.key === "Home") select(0);
    else if (event.key === "End") select(last);
    else if (event.key === "Enter" && active !== undefined) open(active);
    else if (
      (event.key === "ContextMenu" ||
        (event.key === "F10" && event.shiftKey)) &&
      selected !== undefined
    )
      openMenu(rowId(selected));
    else return;
    event.preventDefault();
  };

  const row = (index: number) => {
    const range = ranges[index];
    if (range === undefined) return null;
    return (
      <RangeRow
        id={rowId(index)}
        index={index}
        commit={commitOf(range)}
        selected={index === selected}
        onOpen={() => open(range)}
      />
    );
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            aria-activedescendant={
              selected === undefined ? undefined : rowId(selected)
            }
            aria-label="Blamed lines"
            className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring focus-visible:ring-inset"
            onClick={onClick}
            onContextMenuCapture={onClick}
            onDoubleClick={onDoubleClick}
            onKeyDown={onKeyDown}
            role="listbox"
            data-reveal-line={line}
            ref={observeWidth}
            tabIndex={0}
          >
            <File
              style={
                {
                  "--diffs-font-family": "var(--font-mono)",
                  "--diffs-font-size": "var(--text-meta)",
                  "--diffs-line-height": "20px",
                } as CSSProperties
              }
              file={{ name: path, contents: text }}
              lineAnnotations={ranges.flatMap((range, index) =>
                range.start > 1
                  ? [{ lineNumber: range.start - 1, metadata: index }]
                  : [],
              )}
              renderAnnotation={(annotation) => row(annotation.metadata)}
              renderCustomHeader={() => (
                <div className="pl-(--blame-gutter)">{row(0)}</div>
              )}
              selectedLines={
                active === undefined
                  ? null
                  : {
                      start: active.start,
                      end: active.start + active.count - 1,
                    }
              }
              options={{
                theme: diffThemes,
                themeType: theme,
                overflow: "wrap",
                unsafeCSS: diffSurfaceCSS,
                onPostRender: (container, _instance, phase) => {
                  const list = container.closest<HTMLElement>("[role=listbox]");
                  if (phase !== "unmount" && list !== null) measure(list);
                },
              }}
            />
          </div>
        }
      />
      <ContextMenuContent className="w-max min-w-48 max-w-md">
        <ActionMenuItems actions={actionsFor(active)} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function rangeContaining(ranges: readonly BlameRange[], line: number) {
  return ranges.findIndex(
    (range) => line >= range.start && line < range.start + range.count,
  );
}

function observeWidth(node: HTMLDivElement) {
  const observer = new ResizeObserver(() => measure(node));
  observer.observe(node);
  return () => observer.disconnect();
}

function measure(list: HTMLElement) {
  const gutter = list
    .querySelector("diffs-container")
    ?.shadowRoot?.querySelector("[data-gutter]")
    ?.getBoundingClientRect().width;
  list.style.setProperty("--blame-gutter", `${gutter ?? 0}px`);
  list.style.setProperty(
    "--blame-row",
    `${list.clientWidth - (gutter ?? 0)}px`,
  );
  const line = list.dataset.revealLine;
  const target = list
    .querySelector("diffs-container")
    ?.shadowRoot?.querySelector(`[data-line="${line}"]`);
  if (target && list.clientHeight > 0 && !revealed.has(list)) {
    revealed.add(list);
    target.scrollIntoView({ block: "center" });
  }
}

const revealed = new WeakSet<Element>();
