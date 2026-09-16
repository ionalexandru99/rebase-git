import type { CommitFile } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import {
  IconChevronDown,
  IconChevronRight,
  IconFolder,
} from "@tabler/icons-react";
import { useCommitFiles } from "#web/features/commit-inspection/hooks/use-commit-files";

const statusLabels: Record<CommitFile["status"], string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  T: "Type changed",
};

export function CommitFiles({
  files,
  path,
  select,
}: {
  readonly files: readonly CommitFile[];
  readonly path: string | null;
  readonly select: (path: string) => void;
}) {
  const {
    rows,
    collapsed,
    active,
    activeIndex,
    scrollRef,
    virtualizer,
    toggle,
    activate,
    onKeyDown,
  } = useCommitFiles(files, path, select);
  return (
    <section
      className="flex min-h-0 flex-col border-border border-l"
      aria-label="Changed files"
    >
      <div className="flex shrink-0 items-center justify-between border-border border-b p-3 text-xs">
        Changed files{" "}
        <span className="text-muted-foreground">{files.length}</span>
      </div>
      <div
        ref={scrollRef}
        role="tree"
        aria-label="Commit files"
        aria-activedescendant={
          activeIndex < 0 ? undefined : `commit-file-${activeIndex}`
        }
        tabIndex={0}
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
        onKeyDown={onKeyDown}
      >
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const file = row.file;
            return (
              <div
                role="treeitem"
                aria-level={row.depth + 1}
                aria-selected={file !== undefined && path === file.path}
                aria-expanded={
                  file === undefined ? !collapsed.has(row.key) : undefined
                }
                aria-label={
                  file
                    ? `${file.path} ${statusLabels[file.status]}${file.previousPath ? ` from ${file.previousPath}` : ""}`
                    : row.key
                }
                id={`commit-file-${item.index}`}
                key={row.key}
                tabIndex={-1}
                data-active={active === row.key}
                className="absolute inset-x-0 cursor-default py-1.5 pr-3 text-xs aria-selected:bg-primary/15 data-[active=true]:ring-1 data-[active=true]:ring-primary/40 data-[active=true]:ring-inset"
                style={{
                  top: item.start,
                  height: item.size,
                  paddingLeft: 10 + row.depth * 12,
                }}
                onClick={() => {
                  activate(item.index);
                  if (!file) toggle(row.key, !collapsed.has(row.key));
                  scrollRef.current?.focus();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") activate(item.index);
                }}
              >
                <div className="flex items-center gap-1.5">
                  {file ? null : (
                    <>
                      {collapsed.has(row.key) ? (
                        <IconChevronRight className="size-3 shrink-0" />
                      ) : (
                        <IconChevronDown className="size-3 shrink-0" />
                      )}
                      <IconFolder className="size-3 shrink-0 text-muted-foreground" />
                    </>
                  )}
                  <span className="min-w-0 flex-1 truncate font-mono">
                    {row.name}
                  </span>
                  {file ? (
                    <span
                      aria-hidden="true"
                      className={
                        file.status === "A"
                          ? "text-green-400"
                          : file.status === "D"
                            ? "text-red-400"
                            : "text-muted-foreground"
                      }
                    >
                      {file.status}
                    </span>
                  ) : null}
                </div>
                {file?.previousPath ? (
                  <div className="mt-1 truncate text-muted-foreground">
                    from {file.previousPath}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
