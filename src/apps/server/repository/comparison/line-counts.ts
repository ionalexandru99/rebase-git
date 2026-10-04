import type { ChangedLines } from "#contracts/repository-changes/repository-changes.contract.ts";

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
