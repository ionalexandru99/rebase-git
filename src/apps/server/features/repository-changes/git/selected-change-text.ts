import { diffLines } from "diff";

export function selectedChangeText(
  before: string,
  after: string,
  lines: readonly string[],
  reverse: boolean,
) {
  const selected = new Set(lines);
  const found = new Set<string>();
  const output: string[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const change of diffLines(before, after)) {
    for (const line of change.value.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      const id = change.removed ? `-${oldLine}` : `+${newLine}`;
      const changed = change.added || change.removed;
      const chosen = changed && selected.has(id);
      if (chosen) found.add(id);
      if (
        !changed ||
        (reverse
          ? change.removed
            ? chosen
            : !chosen
          : change.added
            ? chosen
            : !chosen)
      )
        output.push(line);
      if (!change.added) oldLine++;
      if (!change.removed) newLine++;
    }
  }
  if (found.size !== selected.size || found.size === 0)
    throw new Error(
      "The selected lines have changed. Refresh the diff and select them again.",
    );
  return output.join("");
}
