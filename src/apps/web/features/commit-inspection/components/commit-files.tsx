import { IconFileDiff } from "@tabler/icons-react";
import {
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { CommitFile } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import { IconToggles } from "#web/components/ui/icon-switch.tsx";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web/components/ui/resizable.tsx";
import type { DiffPreferences } from "#web/domain/file-diff/diff-preferences.contract.ts";
import {
  FileListSection,
  openMenu,
  RowLead,
} from "#web/features/file-diff/components/file-list-section.tsx";
import { FileListToolbar } from "#web/features/file-diff/components/file-list-toolbar.tsx";
import {
  FileRowName,
  LineCounts,
} from "#web/features/file-diff/components/file-row-name.tsx";
import type { ChangeTreeRow } from "#web/features/file-diff/file-tree.ts";
import { cn } from "#web/lib/utils.ts";

export function CommitFiles({
  files,
  path,
  select,
  preferences,
  choosePreferences,
  actionsFor,
  onMenuClose,
  lead,
  children,
}: {
  readonly lead?: ReactNode;
  readonly files: readonly CommitFile[];
  readonly path: string | null;
  readonly select: (path: string) => void;
  readonly preferences: DiffPreferences;
  readonly choosePreferences: (preferences: DiffPreferences) => void;
  readonly actionsFor?:
    | ((paths: readonly string[], anchor: string) => readonly Action[])
    | undefined;
  readonly onMenuClose?: (() => void) | undefined;
  readonly children: (treeToggle: ReactNode) => ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const [marked, setMarked] = useState<{
    readonly files: readonly CommitFile[];
    readonly paths: ReadonlySet<string>;
  }>({ files, paths: new Set() });
  const checked = marked.files === files ? marked.paths : new Set<string>();
  const setChecked = (paths: ReadonlySet<string>) =>
    setMarked({ files, paths });
  const anchor = useRef<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const selected: ReadonlySet<string> =
    path !== null && checked.has(path)
      ? checked
      : new Set(path === null ? [] : [path]);
  const tree = preferences.tree;
  const frame = useRef<HTMLDivElement>(null);
  const narrow = useNarrowerThan(frame, 32);
  const [treeChoice, setTreeChoice] = useState<{
    readonly shown: boolean;
    readonly path: string | null;
  }>();
  const treeShown =
    treeChoice === undefined || (narrow && treeChoice.path !== path)
      ? !narrow
      : treeChoice.shown;
  const toggleSlot = useRef<HTMLSpanElement>(null);
  const refocus = useRef(false);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    toggleSlot.current?.querySelector("button")?.focus();
  });
  const chooseTree = (shown: boolean | undefined) => {
    refocus.current = true;
    setTreeChoice(
      shown === undefined || (narrow && !shown) ? undefined : { shown, path },
    );
  };
  const selectInTree = (next: string) => {
    select(next);
    if (treeChoice !== undefined) setTreeChoice({ ...treeChoice, path: next });
  };
  const treeToggle = (
    <span ref={toggleSlot} className="contents">
      <IconToggles
        toggles={[
          {
            label: "File tree",
            Icon: IconFileDiff,
            pressed: treeShown,
            onChange: chooseTree,
          },
        ]}
      />
    </span>
  );

  const click = (
    event: MouseEvent<HTMLButtonElement>,
    row: ChangeTreeRow<CommitFile>,
    rows: readonly ChangeTreeRow<CommitFile>[],
    index: number,
    toggle: (key: string) => void,
  ) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      const start = rows.findIndex(
        (entry) => entry.key === (anchor.current ?? path),
      );
      const paths =
        event.shiftKey && start >= 0
          ? rows
              .slice(Math.min(start, index), Math.max(start, index) + 1)
              .flatMap((entry) => (entry.file ? entry.paths : []))
          : row.paths;
      const next = new Set(event.shiftKey ? [] : selected);
      const remove = !event.shiftKey && paths.every((entry) => next.has(entry));
      for (const entry of paths) {
        if (remove) next.delete(entry);
        else next.add(entry);
      }
      if (!event.shiftKey) anchor.current = row.key;
      setChecked(next);
      const [first] = next;
      if (path !== null && !next.has(path) && first !== undefined)
        selectInTree(first);
      return;
    }
    anchor.current = row.key;
    if (row.file === undefined) {
      toggle(row.key);
      return;
    }
    setChecked(new Set([row.file.path]));
    select(row.file.path);
    if (narrow) chooseTree(undefined);
  };

  const menuPaths = (row: ChangeTreeRow<CommitFile>) =>
    row.paths.every((entry) => selected.has(entry)) ? [...selected] : row.paths;

  const pick = (row: ChangeTreeRow<CommitFile>) => {
    const target = menuTarget(row);
    if (target === undefined || actionsFor === undefined) return;
    if (!row.paths.every((entry) => selected.has(entry))) {
      anchor.current = row.key;
      setChecked(new Set(row.paths));
    }
    selectInTree(target);
  };

  const fileList = (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col border-border bg-sidebar pb-1",
        !narrow && "border-l",
      )}
      ref={list}
    >
      <FileListToolbar
        filter={filter}
        onFilter={setFilter}
        tree={tree}
        onTree={(next) => choosePreferences({ ...preferences, tree: next })}
        region={list}
      >
        {treeToggle}
      </FileListToolbar>
      {lead}
      <FileListSection
        name="Changed files"
        title="Changed files"
        look={{ Icon: IconFileDiff, className: "text-sidebar-foreground" }}
        grow
        files={files}
        tree={tree}
        filter={filter}
        chosen={(row) => row.file !== undefined && selected.has(row.key)}
        menu={
          actionsFor &&
          ((row) => {
            const target = menuTarget(row);
            return target === undefined
              ? []
              : actionsFor(menuPaths(row), target);
          })
        }
        onMenuClose={onMenuClose}
        onMenuOpen={pick}
      >
        {(row, { rows, index, collapsed, toggle }) => {
          const file = row.file;
          const statusId = `commit-status-${encodeURIComponent(row.key)}`;
          return (
            <>
              <button
                type="button"
                className="flex h-full min-w-0 flex-1 cursor-default items-center gap-2 text-left outline-none"
                aria-label={
                  file
                    ? `${file.path}${file.previousPath ? ` renamed from ${file.previousPath}` : ""}`
                    : `Folder ${row.key}`
                }
                aria-pressed={file ? selected.has(file.path) : undefined}
                aria-expanded={file ? undefined : !collapsed.has(row.key)}
                aria-describedby={file ? statusId : undefined}
                onClick={(event) => click(event, row, rows, index, toggle)}
                onKeyDown={openMenu}
              >
                <RowLead row={row} collapsed={collapsed} />
                <FileRowName row={row} tree={tree} statusId={statusId} />
              </button>
              {file ? <LineCounts lines={file.lines} /> : null}
            </>
          );
        }}
      </FileListSection>
    </div>
  );
  const diff = children(treeShown ? null : treeToggle);

  return (
    <div ref={frame} className="flex min-h-0 flex-1 flex-col">
      {narrow === undefined ? null : narrow ? (
        <>
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col",
              treeShown && "hidden",
            )}
          >
            {diff}
          </div>
          {treeShown ? fileList : null}
        </>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          <ResizablePanel id="commit-diff" defaultSize="70%" minSize="12rem">
            {diff}
          </ResizablePanel>
          {treeShown ? (
            <>
              <ResizableHandle aria-label="Resize changed-file tree" />
              <ResizablePanel
                id="commit-files"
                defaultSize="21rem"
                groupResizeBehavior="preserve-pixel-size"
                minSize="12.5rem"
                maxSize="26rem"
              >
                {fileList}
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
      )}
    </div>
  );
}

function useNarrowerThan(frame: RefObject<HTMLElement | null>, rem: number) {
  const [narrow, setNarrow] = useState<boolean>();
  useLayoutEffect(() => {
    const element = frame.current;
    if (element === null) return;
    const measure = () => {
      const root = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      setNarrow(element.clientWidth < rem * root);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame, rem]);
  return narrow;
}

function menuTarget(row: ChangeTreeRow<CommitFile>) {
  return row.file?.path ?? row.paths[0];
}
