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
  for (const file of [...visible].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    const parts = file.path.split("/");
    let hidden = false;
    for (let depth = 0; depth < parts.length - 1; depth++) {
      const key = parts.slice(0, depth + 1).join("/");
      if (!folders.has(key)) {
        folders.add(key);
        rows.push({
          key: `${key}/`,
          name: parts[depth] ?? key,
          depth,
          paths: folderPaths.get(key) ?? [],
        });
      }
      if (collapsed.has(`${key}/`)) {
        hidden = true;
        break;
      }
    }
    if (!hidden)
      rows.push({
        key: file.path,
        name: parts.at(-1) ?? file.path,
        depth: parts.length - 1,
        paths: [file.path],
        file,
      });
  }
  return rows;
}
