export function renameHint(previousPath: string, path: string) {
  const { prefix, before, suffix } = renameParts(previousPath, path);
  if (suffix.length === 0) return before.join("/");
  const folder = before.length > 0 ? before : prefix.slice(-1);
  return `${folder.join("/")}/`;
}

export function compactRename(previousPath: string, path: string) {
  const { prefix, before, after, suffix } = renameParts(previousPath, path);
  return [
    ...prefix,
    `{${before.join("/")} → ${after.join("/")}}`,
    ...suffix,
  ].join("/");
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
    after: to.slice(start, to.length - end),
    suffix: from.slice(from.length - end),
  };
}
