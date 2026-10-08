import type { FileTreeBatchOperation, GitStatusEntry } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { useEffect, useRef, useState } from "react";
import type { RepositoryChanges } from "#contracts/repository-changes/repository-changes.contract.ts";
import {
  WorktreeFilesApi,
  type WorktreeFolder,
} from "#contracts/worktree-files/worktree-files.contract.ts";
import {
  type Action,
  ActionMenuItems,
  submenu,
} from "#web/components/ui/action-menu.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import { fileIcons } from "#web/components/ui/file-icon.tsx";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text.ts";
import { useBlameAction } from "#web/features/file-blame/file-blame.ts";
import { useFileHistoryAction } from "#web/features/file-history/file-history.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useShowChangeAction } from "#web/features/working-changes/show-change.ts";
import { useEnvironmentQueries } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";

export interface WorktreeScope {
  readonly repositoryId: string;
  readonly worktreePath: string;
}

const treeCSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: var(--sidebar-accent);
    --trees-hover-bg-override: color-mix(in oklab, var(--sidebar-accent) 75%, transparent);
    --trees-border-color-override: var(--sidebar-border);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: var(--text-body);
    --trees-fg-override: var(--sidebar-foreground);
  }
  button[data-type='item'] { border-radius: var(--radius-control, 6px); }
`;

export function WorktreeTree({
  scope,
  changes,
  matches,
  query,
  selected,
  hidden,
  onOpen,
}: {
  readonly scope: WorktreeScope;
  readonly changes: RepositoryChanges | undefined;
  readonly matches: readonly string[];
  readonly query: string;
  readonly selected: string | null;
  readonly hidden: boolean;
  readonly onOpen: (path: string) => void;
}) {
  const [loaded, setLoaded] = useState<readonly string[]>([""]);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const folders = useEnvironmentQueries(
    WorktreeFilesApi.list,
    loaded.map((folder) => ({ ...scope, folder })),
    {
      changes: "index",
      staleTime: 0,
      refetchOnWindowFocus: ({ folder }) =>
        folderAncestors(`${folder}/`).every(
          (ancestor) => ancestor === "" || expanded.has(ancestor),
        ),
    },
  );
  const listed = new Map(
    loaded.flatMap((folder, index) => {
      const data = folders[index]?.data;
      return data === undefined ? [] : [[folder, data] as const];
    }),
  );
  const { paths, ignored } = treePaths(listed, matches);
  const pathList = paths.join("\0");
  const statusList = JSON.stringify(treeStatus(changes, ignored));
  const open = useRef(onOpen);
  const echo = useRef(false);
  const folderPaths = useRef<readonly string[]>([]);
  useEffect(() => {
    open.current = onOpen;
  });
  const { model } = useFileTree({
    paths: [],
    density: "compact",
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    fileTreeSearchMode: "hide-non-matches",
    icons: fileIcons,
    search: false,
    unsafeCSS: treeCSS,
    onSelectionChange: (selection) => {
      const path = selection.at(-1);
      if (echo.current || path === undefined || path.endsWith("/")) return;
      open.current(path);
    },
  });
  const shown = useRef<readonly string[] | null>(null);
  useEffect(() => {
    const next = pathList === "" ? [] : pathList.split("\0");
    folderPaths.current = next.filter((path) => path.endsWith("/"));
    const previous = shown.current;
    shown.current = next;
    if (previous === null) model.resetPaths(next);
    else {
      const updates = pathUpdates(previous, next);
      if (updates.length > 0) model.batch(updates);
    }
  }, [model, pathList]);
  useEffect(() => {
    model.setGitStatus(JSON.parse(statusList) as GitStatusEntry[]);
  }, [model, statusList]);
  useEffect(() => {
    model.setSearch(query === "" ? null : query);
  }, [model, query]);
  useEffect(
    () =>
      model.subscribe(() => {
        const expanded = folderPaths.current
          .filter((path) => {
            const item = model.getItem(path);
            return item !== null && "isExpanded" in item && item.isExpanded();
          })
          .map((path) => path.slice(0, -1));
        setLoaded((current) => {
          const added = expanded.filter((folder) => !current.includes(folder));
          return added.length === 0 ? current : [...current, ...added];
        });
        setExpanded((current) =>
          current.size === expanded.length &&
          expanded.every((folder) => current.has(folder))
            ? current
            : new Set(expanded),
        );
      }),
    [model],
  );
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (query !== "") revealed.current = null;
    if (selected === null || query !== "" || revealed.current === selected)
      return;
    const ancestors = folderAncestors(selected);
    setLoaded((current) => {
      const added = ancestors.filter((folder) => !current.includes(folder));
      return added.length === 0 ? current : [...current, ...added];
    });
    const item = model.getItem(selected);
    if (item === null || !pathList.split("\0").includes(selected)) return;
    revealed.current = selected;
    echo.current = true;
    for (const folder of ancestors.slice(1)) {
      const parent = model.getItem(`${folder}/`);
      if (parent !== null && "expand" in parent) parent.expand();
    }
    if (!model.getSelectedPaths().includes(selected)) {
      for (const path of model.getSelectedPaths())
        model.getItem(path)?.deselect();
      item.select();
    }
    model.scrollToPath(selected, { offset: "nearest" });
    echo.current = false;
  }, [model, selected, query, pathList]);
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const actions = useRowActions(changes, ignored);
  const failed = folders.find((folder) => folder.error !== null)?.error;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<div className="min-h-0 flex-1" hidden={hidden} />}
        onContextMenu={(event) =>
          setMenuPath(rowPath(event.nativeEvent.composedPath()))
        }
      >
        {failed ? (
          <p role="alert" className="p-3 text-body">
            {describeFailure(failed)}
          </p>
        ) : null}
        <FileTree
          model={model}
          aria-label="Worktree files"
          className="h-full min-h-0"
        />
      </ContextMenuTrigger>
      {menuPath === null ? null : (
        <ContextMenuContent className="w-max min-w-48 max-w-md">
          <ActionMenuItems actions={actions(menuPath)} />
        </ContextMenuContent>
      )}
    </ContextMenu>
  );
}

function useRowActions(
  changes: RepositoryChanges | undefined,
  ignored: readonly string[],
) {
  const fileHistory = useFileHistoryAction();
  const blame = useBlameAction();
  const showChange = useShowChangeAction();
  const errorToast = useErrorToast();
  return (path: string): readonly Action[] => {
    const folder = path.endsWith("/");
    const name = folder ? path.slice(0, -1) : path;
    const change = [...(changes?.unstaged ?? []), ...(changes?.staged ?? [])]
      .filter((file) => file.path === name)
      .map((file) => file.status);
    const committed =
      !change.includes("?") &&
      !change.includes("A") &&
      !ignored.some(
        (entry) =>
          entry === path || (entry.endsWith("/") && path.startsWith(entry)),
      );
    return [
      ...(folder || !committed ? [] : fileHistory([name])),
      ...(folder || !committed ? [] : blame([name], null)),
      ...(folder || change.length === 0 ? [] : [showChange(name)]),
      submenu({ id: "copy", label: "Copy", group: "edit" }, [
        {
          id: "copyPath",
          label: "Path",
          enabled: true,
          run: () =>
            void writeClipboardText(name).catch(() =>
              errorToast.show("copyPath"),
            ),
        },
      ]),
    ];
  };
}

function treePaths(
  listed: ReadonlyMap<string, WorktreeFolder>,
  matches: readonly string[],
) {
  const paths = new Set<string>();
  const ignored: string[] = [];
  const visit = (folder: string) => {
    for (const entry of listed.get(folder)?.entries ?? []) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      const treePath = entry.kind === "folder" ? `${path}/` : path;
      paths.add(treePath);
      if (entry.ignored) ignored.push(treePath);
      if (entry.kind === "folder" && listed.has(path)) visit(path);
    }
  };
  visit("");
  for (const match of matches) {
    for (const folder of folderAncestors(match).slice(1))
      paths.add(`${folder}/`);
    paths.add(match);
  }
  return { paths: [...paths], ignored };
}

function treeStatus(
  changes: RepositoryChanges | undefined,
  ignored: readonly string[],
): readonly GitStatusEntry[] {
  const files = [...(changes?.staged ?? []), ...(changes?.unstaged ?? [])];
  return [
    ...files.map(({ path, status }) => ({
      path,
      status:
        status === "?"
          ? ("untracked" as const)
          : status === "A"
            ? ("added" as const)
            : status === "D"
              ? ("deleted" as const)
              : status === "R"
                ? ("renamed" as const)
                : ("modified" as const),
    })),
    ...ignored.map((path) => ({ path, status: "ignored" as const })),
  ];
}

function folderAncestors(path: string) {
  const parts = path.split("/");
  return parts.map((_, index) => parts.slice(0, index).join("/"));
}

function rowPath(path: readonly EventTarget[]) {
  for (const node of path)
    if (node instanceof HTMLElement && node.dataset.itemPath)
      return node.dataset.itemPath;
  return null;
}

function pathUpdates(
  previous: readonly string[],
  next: readonly string[],
): FileTreeBatchOperation[] {
  const before = new Set(previous);
  const after = new Set(next);
  const depth = (path: string) => path.split("/").filter(Boolean).length;
  const removedFolders: string[] = [];
  const updates: FileTreeBatchOperation[] = [];
  for (const path of previous
    .filter((path) => !after.has(path))
    .sort((left, right) => depth(left) - depth(right))) {
    if (removedFolders.some((folder) => path.startsWith(folder))) continue;
    const folder = path.endsWith("/");
    updates.push({
      type: "remove",
      path,
      ...(folder ? { recursive: true } : {}),
    });
    if (folder) removedFolders.push(path);
  }
  for (const path of next
    .filter((path) => !before.has(path))
    .sort((left, right) => depth(left) - depth(right)))
    updates.push({ type: "add", path });
  return updates;
}
