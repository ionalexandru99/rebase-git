import type {
  ChangedFile,
  ChangedLines,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import type { ChangeTreeRow } from "#web/features/file-diff/file-tree.ts";
import { compactCount } from "#web/lib/compact-count.ts";
import { cn } from "#web/lib/utils.ts";

type FileStatus = Exclude<ChangedFile["status"], "U">;

export interface NamedFile {
  readonly path: string;
  readonly previousPath: string | null;
  readonly status: ChangedFile["status"];
}

const statusTones: Partial<Record<FileStatus, string>> = {
  A: "text-success",
  "?": "text-success",
  D: "text-destructive line-through decoration-destructive/60",
  R: "text-info",
};

const statusLabels: Record<FileStatus, string> = {
  A: "Added",
  M: "Modified",
  D: "Deleted",
  R: "Renamed",
  T: "Type changed",
  "?": "Untracked",
};

export function FileRowName<File extends NamedFile>({
  row,
  tree,
  statusId,
}: {
  readonly row: ChangeTreeRow<File>;
  readonly tree: boolean;
  readonly statusId: string;
}) {
  if (row.file === undefined)
    return <span className="min-w-0 truncate text-body">{row.name}/</span>;
  const { previousPath, status } = row.file;
  const tone = status === "U" ? undefined : statusTones[status];
  return (
    <>
      {tree ? (
        <>
          <span className={cn("min-w-0 truncate", tone)}>{row.name}</span>
          {previousPath ? (
            <span className="min-w-0 shrink-[100] truncate text-meta text-muted-foreground">
              ← {renameHint(previousPath, row.key)}
            </span>
          ) : null}
        </>
      ) : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className={cn("truncate", tone)}>{fileName(row.key)}</span>
          <span
            className="truncate text-meta text-muted-foreground"
            style={{ direction: "rtl", textAlign: "left" }}
          >
            <bdi>
              {previousPath ? `← ${renameHint(previousPath, row.key)} · ` : ""}
              {folderOf(row.key)}
            </bdi>
          </span>
        </span>
      )}
      {status === "U" ? null : (
        <span id={statusId} className="sr-only">
          {statusLabels[status]}
        </span>
      )}
    </>
  );
}

export function LineCounts({
  lines,
  className,
}: {
  readonly lines: ChangedLines;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-14 justify-end gap-1 pr-1 font-mono text-badge tabular-nums",
        className,
      )}
    >
      {lines && lines.added > 0 ? (
        <span className="text-success">+{compactCount(lines.added)}</span>
      ) : null}
      {lines && lines.removed > 0 ? (
        <span className="text-destructive">−{compactCount(lines.removed)}</span>
      ) : null}
    </span>
  );
}

export function fileName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function folderOf(path: string) {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export function renameHint(previousPath: string, path: string) {
  const { prefix, before, suffix } = renameParts(previousPath, path);
  if (suffix.length === 0) return before.join("/");
  const folder = before.length > 0 ? before : prefix.slice(-1);
  return `${folder.join("/")}/`;
}

function renameParts(previousPath: string, path: string) {
  const from = previousPath.split("/");
  const to = path.split("/");
  let start = 0;
  while (
    start < from.length - 1 &&
    start < to.length - 1 &&
    from[start] === to[start]
  )
    start++;
  let end = 0;
  while (
    end < from.length - start &&
    end < to.length - start &&
    from.at(-1 - end) === to.at(-1 - end)
  )
    end++;
  return {
    prefix: from.slice(0, start),
    before: from.slice(start, from.length - end),
    suffix: from.slice(from.length - end),
  };
}
