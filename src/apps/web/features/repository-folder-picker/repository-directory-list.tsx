import type { EnvironmentDirectoryEntry } from "@rebase/contracts";
import { IconFile, IconFolder } from "@tabler/icons-react";
import type { JSX } from "react";
import { modifiedDateLabel } from "#web/features/repository-folder-picker/repository-folder-picker-state";
import { cn } from "#web/lib/utils";

export function RepositoryDirectoryList({
  entries,
  error,
  loading,
  onEnter,
  onParent,
  onSelect,
  selectedPath,
  truncated,
}: {
  readonly entries: readonly EnvironmentDirectoryEntry[];
  readonly error: string | undefined;
  readonly loading: boolean;
  readonly onEnter: (path: string) => void;
  readonly onParent: () => void;
  readonly onSelect: (path: string) => void;
  readonly selectedPath: string | undefined;
  readonly truncated: boolean;
}): JSX.Element {
  const directories = entries.filter((entry) => entry.type === "directory");

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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid h-[1.85rem] shrink-0 grid-cols-[minmax(0,1fr)_6.5rem_5rem] items-center gap-3 px-4 text-[.66rem] text-muted-foreground uppercase max-[600px]:grid-cols-[minmax(0,1fr)_5rem] max-[600px]:[&>*:last-child]:hidden">
        <span>Name</span>
        <span>Kind</span>
        <span>Modified</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-[.45rem] py-[.15rem]">
        {loading ? (
          <DirectoryMessage>Loading directory…</DirectoryMessage>
        ) : error !== undefined ? (
          <DirectoryMessage>{error}</DirectoryMessage>
        ) : entries.length === 0 ? (
          <DirectoryMessage>This folder is empty.</DirectoryMessage>
        ) : (
          entries.map((entry) =>
            entry.type === "directory" ? (
              <button
                aria-pressed={selectedPath === entry.path}
                className={rowClassName(selectedPath === entry.path)}
                id={directoryOptionId(
                  directories.findIndex(
                    (directory) => directory.path === entry.path,
                  ),
                )}
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
                <EntryName entry={entry} />
                <EntryMetadata>{entry.kind}</EntryMetadata>
                <EntryMetadata className="max-[600px]:hidden">
                  {modifiedDateLabel(entry.modifiedAt)}
                </EntryMetadata>
              </button>
            ) : (
              <div className={rowClassName(false)} key={entry.path}>
                <EntryName entry={entry} />
                <EntryMetadata>{entry.kind}</EntryMetadata>
                <EntryMetadata className="max-[600px]:hidden">
                  {modifiedDateLabel(entry.modifiedAt)}
                </EntryMetadata>
              </div>
            ),
          )
        )}
        {truncated && !loading && error === undefined ? (
          <p className="px-3 py-2 text-[.68rem] text-muted-foreground">
            Only part of this directory is shown.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function directoryOptionId(index: number) {
  return `repository-directory-option-${index}`;
}

function EntryName({ entry }: { readonly entry: EnvironmentDirectoryEntry }) {
  const Icon = entry.type === "directory" ? IconFolder : IconFile;
  return (
    <span className="flex min-w-0 items-center gap-[.65rem]">
      <Icon
        aria-hidden="true"
        className={cn(
          "size-4 shrink-0 text-muted-foreground",
          entry.type === "directory" && "text-foreground/65",
        )}
      />
      <span className="truncate">{entry.name}</span>
    </span>
  );
}

function EntryMetadata({
  children,
  className,
}: {
  readonly children: string;
  readonly className?: string;
}) {
  return (
    <span className={cn("text-[.69rem] text-muted-foreground", className)}>
      {children}
    </span>
  );
}

function DirectoryMessage({ children }: { readonly children: string }) {
  return (
    <div className="grid h-full min-h-32 place-items-center px-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function rowClassName(selected: boolean) {
  return cn(
    "grid h-11 w-full grid-cols-[minmax(0,1fr)_6.5rem_5rem] items-center gap-3 rounded-lg px-3 text-left text-[.8rem] text-foreground/80 outline-none max-[600px]:grid-cols-[minmax(0,1fr)_5rem]",
    "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/30",
    selected && "bg-accent shadow-[inset_0_0_0_1px_rgb(124_140_255/48%)]",
  );
}
