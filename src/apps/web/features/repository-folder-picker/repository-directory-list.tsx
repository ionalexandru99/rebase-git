import {
  IconBrandGit,
  IconFile,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
} from "@tabler/icons-react";
import { type JSX, type ReactNode, useEffect, useId, useRef } from "react";
import type { EnvironmentDirectoryEntry } from "#contracts/environment-filesystem/environment-filesystem.contract.ts";
import { modifiedDateLabel } from "#web/features/repository-folder-picker/repository-folder-picker-state.ts";
import { useNow } from "#web/lib/age-label.ts";
import { cn } from "#web/lib/utils.ts";

export function RepositoryDirectoryList({
  entries,
  error,
  filtering,
  loading,
  newFolder,
  onCancelNewFolder,
  onEnter,
  onNameNewFolder,
  onParent,
  onSelect,
  onSubmitNewFolder,
  selectedPath,
  truncated,
}: {
  readonly entries: readonly EnvironmentDirectoryEntry[];
  readonly error: string | undefined;
  readonly filtering: boolean;
  readonly loading: boolean;
  readonly newFolder: string | undefined;
  readonly onCancelNewFolder: () => void;
  readonly onEnter: (path: string) => void;
  readonly onNameNewFolder: (name: string) => void;
  readonly onSubmitNewFolder: () => void;
  readonly onParent: () => void;
  readonly onSelect: (path: string) => void;
  readonly selectedPath: string | undefined;
  readonly truncated: boolean;
}): JSX.Element {
  const now = useNow();
  const repositories = entries.filter(isRepository);
  const folders = [
    ...entries.filter(
      (entry) => entry.type === "directory" && !isRepository(entry),
    ),
    ...entries.filter((entry) => entry.type === "file"),
  ];
  const directories = [...repositories, ...folders].filter(
    (entry) => entry.type === "directory",
  );
  const newFolderRef = useRef<HTMLInputElement>(null);
  const naming = newFolder !== undefined;
  useEffect(() => {
    if (naming) newFolderRef.current?.focus();
  }, [naming]);

  const moveSelection = (direction: -1 | 1) => {
    if (directories.length === 0) return;
    const selectedIndex = directories.findIndex(
      (entry) => entry.path === selectedPath,
    );
    const nextIndex =
      selectedIndex < 0
        ? direction > 0
          ? 0
          : directories.length - 1
        : (selectedIndex + direction + directories.length) % directories.length;
    const next = directories[nextIndex];
    if (next === undefined) return;
    onSelect(next.path);
    requestAnimationFrame(() =>
      document.getElementById(directoryOptionId(nextIndex))?.focus(),
    );
  };

  const row = (entry: EnvironmentDirectoryEntry) => {
    const date = (
      <span className="text-meta font-normal text-muted-foreground tabular-nums">
        {modifiedDateLabel(entry.modifiedAt, now)}
      </span>
    );
    if (entry.type === "file") {
      return (
        <div
          className={cn(rowClassName(false), "hover:bg-transparent")}
          key={entry.path}
        >
          <EntryName entry={entry} selected={false} />
          {date}
        </div>
      );
    }
    const selected = selectedPath === entry.path;
    return (
      <button
        aria-pressed={selected}
        className={rowClassName(selected)}
        id={directoryOptionId(directories.indexOf(entry))}
        key={entry.path}
        onClick={() => onSelect(entry.path)}
        onDoubleClick={() => onEnter(entry.path)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(event.key === "ArrowDown" ? 1 : -1);
            return;
          }
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onParent();
            return;
          }
          if (
            event.key === "ArrowRight" ||
            (event.key === "Enter" && !event.ctrlKey && !event.metaKey)
          ) {
            event.preventDefault();
            onEnter(entry.path);
          }
        }}
        type="button"
      >
        <EntryName entry={entry} selected={selected} />
        {date}
      </button>
    );
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      {loading ? (
        <DirectoryMessage>Loading directory…</DirectoryMessage>
      ) : error !== undefined ? (
        <DirectoryMessage>{error}</DirectoryMessage>
      ) : newFolder === undefined && entries.length === 0 && filtering ? (
        <DirectoryMessage>No matching folders</DirectoryMessage>
      ) : newFolder === undefined && entries.length === 0 ? (
        <DirectoryMessage>
          <IconFolderOpen
            aria-hidden="true"
            className="size-6 text-muted-foreground/60"
            stroke={1.5}
          />
          This folder is empty
        </DirectoryMessage>
      ) : (
        <>
          {newFolder === undefined ? null : (
            <div className={cn(rowClassName(true), "mt-2")}>
              <IconFolderPlus
                aria-hidden="true"
                className="size-4 shrink-0 text-primary"
              />
              <input
                aria-label="New folder name"
                ref={newFolderRef}
                className="h-7 w-64 min-w-0 rounded-control border border-ring bg-transparent px-2 text-control text-foreground outline-none"
                onChange={(event) => onNameNewFolder(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onSubmitNewFolder();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    onCancelNewFolder();
                  }
                }}
                value={newFolder}
              />
            </div>
          )}
          <EntrySection label="Repositories">
            {repositories.map(row)}
          </EntrySection>
          <EntrySection label="Folders">{folders.map(row)}</EntrySection>
        </>
      )}
      {truncated && !loading && error === undefined ? (
        <p className="px-3 py-2 text-meta text-muted-foreground">
          Only part of this directory is shown.
        </p>
      ) : null}
    </div>
  );
}

function isRepository(entry: EnvironmentDirectoryEntry) {
  return entry.type === "directory" && entry.kind === "Repository";
}

function directoryOptionId(index: number) {
  return `repository-directory-option-${index}`;
}

function EntrySection({
  children,
  label,
}: {
  readonly children: readonly ReactNode[];
  readonly label: string;
}) {
  const id = useId();
  if (children.length === 0) return null;
  return (
    <section aria-labelledby={id} className="mb-2">
      <h3
        className="flex h-8 items-end px-3 pb-1.5 text-badge font-medium tracking-[.05em] text-muted-foreground uppercase"
        id={id}
      >
        {label}
      </h3>
      {children}
    </section>
  );
}

function EntryName({
  entry,
  selected,
}: {
  readonly entry: EnvironmentDirectoryEntry;
  readonly selected: boolean;
}) {
  const Icon = isRepository(entry)
    ? IconBrandGit
    : entry.type === "directory"
      ? IconFolder
      : IconFile;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5">
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0 text-muted-foreground",
          selected && "text-primary",
        )}
      />
      <span
        className={cn(
          "truncate",
          entry.type === "file" && "text-muted-foreground",
        )}
      >
        {entry.name}
      </span>
      <span className="sr-only"> {entry.kind}</span>
    </span>
  );
}

function DirectoryMessage({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 px-4 text-center text-body text-muted-foreground">
      {children}
    </div>
  );
}

function rowClassName(selected: boolean) {
  return cn(
    "relative flex h-9 w-full items-center gap-2.5 rounded-control px-3 text-left text-body text-foreground outline-none",
    "hover:bg-foreground/[.05] focus-visible:ring-2 focus-visible:ring-ring/30",
    selected &&
      "bg-primary/12 font-medium before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary hover:bg-primary/12",
  );
}
