import { File } from "@pierre/diffs/react";
import { IconArrowUpRight, IconPencil } from "@tabler/icons-react";
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
import { Button } from "#web/components/ui/button.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import { AuthorAvatar } from "#web/features/author-avatars/author-avatar.tsx";
import { copyCommitMenu } from "#web/features/clipboard/copy-commit-menu.ts";
import type { CommitInput } from "#web/features/commit-inspection/commit-input.ts";
import {
  diffSurfaceCSS,
  diffThemes,
} from "#web/features/file-diff/components/diff-content.tsx";
import {
  dateLabel,
  openMenu,
} from "#web/features/file-history/file-history-list.tsx";
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
  const [selected, setSelected] = useState(() => {
    const index = line === undefined ? -1 : rangeContaining(ranges, line);
    return index < 0 ? undefined : index;
  });
  const commitOf = (range: BlameRange | undefined) =>
    commits.find((commit) => commit.oid === range?.oid);
  const rowId = (index: number) => `${listId}-${index}`;
  const active = selected === undefined ? undefined : ranges[selected];

  const select = (index: number) => {
    const range = ranges[index];
    if (range === undefined) return;
    setSelected(index);
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

function RangeRow({
  id,
  index,
  commit,
  selected,
  onOpen,
}: {
  readonly id: string;
  readonly index: number;
  readonly commit: BlameCommit | undefined;
  readonly selected: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <div
      aria-selected={selected}
      className={`flex h-6 w-(--blame-row) cursor-default items-center gap-2 border-border/70 border-t pr-1 pl-2 font-sans text-meta select-none ${
        selected
          ? "bg-primary/15 text-foreground"
          : "bg-(--repository) text-muted-foreground"
      }`}
      data-range={index}
      id={id}
      role="option"
      tabIndex={-1}
    >
      {commit === undefined ? (
        <>
          <IconPencil
            aria-hidden="true"
            className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
          />
          <span className="min-w-0 flex-1 truncate text-amber-600 dark:text-amber-400">
            Uncommitted
          </span>
        </>
      ) : (
        <>
          <AuthorAvatar
            commit={{
              oid: commit.oid,
              author: { name: commit.author, email: commit.email },
            }}
          />
          <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
          <span className="shrink-0 tabular-nums">
            {dateLabel(commit.authoredAt)}
          </span>
        </>
      )}
      {selected ? (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={commit === undefined ? "Open in Diffs" : "Open commit"}
          className="-my-1 size-5"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <IconArrowUpRight />
        </Button>
      ) : null}
    </div>
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
