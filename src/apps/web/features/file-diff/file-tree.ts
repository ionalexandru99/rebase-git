export interface ChangeTreeRow<File extends { readonly path: string }> {
  readonly key: string;
  readonly name: string;
  readonly depth: number;
  readonly paths: readonly string[];
  readonly file?: File;
}
export function changeTreeRows<File extends { readonly path: string }>(
  files: readonly File[],
  tree: boolean,
  filter: string,
  collapsed: ReadonlySet<string>,
): readonly ChangeTreeRow<File>[] {
  const visible = files.filter((file) =>
    file.path.toLowerCase().includes(filter.toLowerCase()),
  );
  if (!tree)
    return visible.map((file) => ({
      key: file.path,
      name: file.path,
      depth: 0,
      paths: [file.path],
      file,
    }));
  const rows: ChangeTreeRow<File>[] = [];
  const folders = new Set<string>();
  const folderPaths = new Map<string, string[]>();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const key = parts.slice(0, depth).join("/");
      const paths = folderPaths.get(key) ?? [];
      paths.push(file.path);
      folderPaths.set(key, paths);
    }
  }
  const children = new Map<string, Set<string>>();
  for (const file of visible) {
    const parts = file.path.split("/");
    parts.forEach((part, depth) => {
      const parent = parts.slice(0, depth).join("/");
      const entries = children.get(parent) ?? new Set<string>();
      entries.add(depth < parts.length - 1 ? `${part}/` : part);
      children.set(parent, entries);
    });
  }
  const joined = (key: string) => {
    const entries = children.get(key);
    return entries?.size === 1 && [...entries][0]?.endsWith("/") === true;
  };
  for (const file of [...visible].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    const parts = file.path.split("/");
    let hidden = false;
    let start = 0;
    let shown = 0;
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const key = parts.slice(0, depth + 1).join("/");
      if (joined(key)) continue;
      if (!folders.has(key)) {
        folders.add(key);
        rows.push({
          key: `${key}/`,
          name: parts.slice(start, depth + 1).join("/"),
          depth: shown,
          paths: folderPaths.get(key) ?? [],
        });
      }
      start = depth + 1;
      shown++;
      if (collapsed.has(`${key}/`)) {
        hidden = true;
        break;
      }
    }
    if (!hidden)
      rows.push({
        key: file.path,
        name: parts.at(-1) ?? file.path,
        depth: shown,
        paths: [file.path],
        file,
      });
  }
  return rows;
}
