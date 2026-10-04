import type { ChangedLines } from "#contracts/repository-changes/repository-changes.contract.ts";

export interface ChangedFileRecord {
  readonly path: string;
  readonly previousPath: string | null;
  readonly status: string;
  readonly lines: ChangedLines;
}

export function changedFiles(output: string): readonly ChangedFileRecord[] {
  const fields = output.split("\0");
  const files: Omit<ChangedFileRecord, "lines">[] = [];
  let i = 0;
  while (fields[i]?.startsWith(":")) {
    const status = fields[i++]?.split(" ").at(-1)?.[0] ?? "";
    const first = fields[i++];
    const renamed = status === "R";
    const path = renamed ? fields[i++] : first;
    if (path)
      files.push({
        path,
        previousPath: renamed ? (first ?? null) : null,
        status,
      });
  }
  const counted = lineCounts(fields.slice(i).join("\0"));
  return files.map((file) => ({
    ...file,
    lines: counted.get(file.path) ?? null,
  }));
}

export function lineCounts(output: string) {
  const fields = output.split("\0");
  const counts = new Map<string, ChangedLines>();
  for (let i = 0; i < fields.length; ) {
    const record = fields[i++] ?? "";
    const first = record.indexOf("\t");
    const second = record.indexOf("\t", first + 1);
    if (first < 0 || second < 0) continue;
    const added = record.slice(0, first);
    const removed = record.slice(first + 1, second);
    const path = record.slice(second + 1);
    let target: string | undefined = path;
    if (path === "") {
      target = fields[i + 1];
      i += 2;
    }
    if (target)
      counts.set(
        target,
        added === "-"
          ? null
          : { added: Number(added), removed: Number(removed) },
      );
  }
  return counts;
}
