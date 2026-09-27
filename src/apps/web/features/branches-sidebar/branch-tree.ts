export interface RowHierarchy {
  readonly level: number;
  readonly position: number;
  readonly setSize: number;
}

export interface BranchesSidebarFolderRow extends RowHierarchy {
  readonly kind: "folder";
  readonly id: string;
  readonly sectionId: string;
  readonly parentId: string;
  readonly path: string;
  readonly label: string;
  readonly expanded: boolean;
}

interface TreeRef {
  readonly name: string;
  readonly sectionId: string;
  readonly current: boolean;
}

type BranchTreeNode<Ref extends TreeRef> =
  | {
      readonly kind: "ref";
      readonly label: string;
      readonly row: Ref;
    }
  | {
      readonly kind: "folder";
      readonly label: string;
      readonly path: string;
      current: boolean;
      readonly children: Map<string, BranchTreeNode<Ref>>;
    };

export function buildBranchTree<Ref extends TreeRef>(
  refs: readonly Ref[],
  folders: ReadonlyMap<string, boolean>,
  searching: boolean,
): readonly (Ref | BranchesSidebarFolderRow)[] {
  const root = new Map<string, BranchTreeNode<Ref>>();
  for (const row of refs) insertBranch(root, row);
  const first = refs[0];
  if (first === undefined) return [];
  return flattenBranchTree(root, first.sectionId, folders, searching);
}

function insertBranch<Ref extends TreeRef>(
  root: Map<string, BranchTreeNode<Ref>>,
  row: Ref,
) {
  const parts = row.name.split("/");
  let children = root;
  let path = "";
  for (const [index, label] of parts.entries()) {
    if (index === parts.length - 1) {
      children.set(`ref:${label}`, { kind: "ref", label, row });
      return;
    }
    path = path === "" ? label : `${path}/${label}`;
    const key = `folder:${label}`;
    let node = children.get(key);
    if (node?.kind !== "folder") {
      node = {
        kind: "folder",
        label,
        path,
        current: false,
        children: new Map(),
      };
      children.set(key, node);
    }
    node.current ||= row.current;
    children = node.children;
  }
}

function flattenBranchTree<Ref extends TreeRef>(
  root: ReadonlyMap<string, BranchTreeNode<Ref>>,
  sectionId: string,
  folders: ReadonlyMap<string, boolean>,
  searching: boolean,
): readonly (Ref | BranchesSidebarFolderRow)[] {
  const rows: (Ref | BranchesSidebarFolderRow)[] = [];
  appendChildren(root, `section:${sectionId}`, 2);
  return rows;

  function appendChildren(
    children: ReadonlyMap<string, BranchTreeNode<Ref>>,
    parentId: string,
    level: number,
  ) {
    const sorted = [...children.values()].sort((left, right) => {
      if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
      return left.label.localeCompare(right.label);
    });
    for (const [index, node] of sorted.entries()) {
      const hierarchy = {
        level,
        parentId,
        position: index + 1,
        setSize: sorted.length,
      };
      if (node.kind === "ref") {
        rows.push({ ...node.row, ...hierarchy, label: node.label });
        continue;
      }
      const id = `folder:${sectionId}:${node.path}`;
      const expanded = searching || (folders.get(id) ?? node.current);
      const folder: BranchesSidebarFolderRow = {
        ...hierarchy,
        id,
        kind: "folder",
        label: node.label,
        path: node.path,
        sectionId,
        expanded,
      };
      rows.push(folder);
      if (expanded) appendChildren(node.children, id, level + 1);
    }
  }
}
