import type { CommitFile } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import {
  IconChevronDown,
  IconChevronRight,
  IconFolder,
} from "@tabler/icons-react";
import { useFileRows } from "#web/features/file-diff/index";

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
  const { rows, collapsed, scrollRef, virtualizer, toggle } =
    useFileRows(files);
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
        className="min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <div
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            const file = row.file;
            return (
              <button
                type="button"
                aria-pressed={
                  file !== undefined ? path === file.path : undefined
                }
                aria-expanded={
                  file === undefined ? !collapsed.has(row.key) : undefined
                }
                aria-label={
                  file
                    ? `${file.path} ${statusLabels[file.status]}${file.previousPath ? ` from ${file.previousPath}` : ""}`
                    : row.key
                }
                key={row.key}
                className="absolute inset-x-0 cursor-default py-1.5 pr-3 text-left text-xs aria-pressed:bg-primary/15 focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:ring-inset"
                style={{
                  top: item.start,
                  height: item.size,
                  paddingLeft: 10 + row.depth * 12,
                }}
                onClick={() => (file ? select(file.path) : toggle(row.key))}
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
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
