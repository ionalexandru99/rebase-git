import type {
  BranchUpstreamTarget,
  LocalBranch,
  RemoteBranch,
  RepositoryRefs,
} from "@rebase/contracts";
import type { BranchesSidebarRefRow } from "#web/features/branches-sidebar/branches-sidebar.contract";

export type BranchRowActionId =
  | "delete"
  | "deleteBoth"
  | "deleteRemote"
  | "newBranch"
  | "rename"
  | "upstream";

export interface BranchRowAction {
  readonly disabledReason?: string;
  readonly group: "create" | "delete" | "edit";
  readonly id: BranchRowActionId;
  readonly label: string;
  readonly shortcut?: string;
}

export interface BranchDeletion {
  readonly local?: LocalBranch & { readonly target: string };
  readonly remote?: RemoteBranch & { readonly target: string };
}

export interface BranchStartPoint {
  readonly label: string;
  readonly name: string;
  readonly oid: string;
  readonly track?: BranchUpstreamTarget;
}

export function branchRowActions(
  row: BranchesSidebarRefRow,
  refs: RepositoryRefs,
  activeWorktreePath: string,
  writable: boolean,
): readonly BranchRowAction[] {
  const readOnly = writable ? undefined : "Read only";
  const newBranch = action("newBranch", "create", "New branch from here…", {
    disabledReason:
      readOnly ??
      (branchStartPoint(row, refs) === undefined
        ? "No commits yet"
        : undefined),
  });
  const deleteOnRemote = (remote: RemoteBranch | undefined) =>
    remote === undefined
      ? []
      : [
          action("deleteRemote", "delete", `Delete on ${remote.remote}`, {
            disabledReason: readOnly,
          }),
        ];
  const branch = localBranch(row, refs);
  if (branch === undefined)
    return [newBranch, ...deleteOnRemote(remoteBranch(row, refs))];
  const elsewhere =
    branch.worktreePath !== undefined &&
    branch.worktreePath !== activeWorktreePath
      ? "In another worktree"
      : undefined;
  const checkedOut =
    readOnly ??
    elsewhere ??
    (branch.worktreePath === undefined ? undefined : "Checked out");
  const counterpart = trackedRemoteBranch(branch, refs);
  return [
    newBranch,
    action("rename", "edit", "Rename…", {
      disabledReason: readOnly ?? elsewhere,
      shortcut: "F2",
    }),
    action("upstream", "edit", "Upstream…", { disabledReason: readOnly }),
    action("delete", "delete", "Delete local", {
      disabledReason: checkedOut,
      shortcut: "Del",
    }),
    ...deleteOnRemote(counterpart),
    ...(counterpart === undefined
      ? []
      : [
          action("deleteBoth", "delete", "Delete both", {
            disabledReason: checkedOut,
          }),
        ]),
  ];
}

export function branchDeletion(
  id: BranchRowActionId,
  row: BranchesSidebarRefRow,
  refs: RepositoryRefs,
): BranchDeletion | undefined {
  const branch = localBranch(row, refs);
  const local =
    branch?.target === undefined
      ? undefined
      : { ...branch, target: branch.target };
  const tracked =
    branch === undefined
      ? remoteBranch(row, refs)
      : trackedRemoteBranch(branch, refs);
  const remote =
    tracked?.target === undefined
      ? undefined
      : { ...tracked, target: tracked.target };
  switch (id) {
    case "delete":
      return local === undefined ? undefined : { local };
    case "deleteRemote":
      return remote === undefined ? undefined : { remote };
    case "deleteBoth":
      return local === undefined || remote === undefined
        ? undefined
        : { local, remote };
    default:
      return undefined;
  }
}

export function localBranch(
  row: BranchesSidebarRefRow,
  refs: RepositoryRefs,
): LocalBranch | undefined {
  return row.target._tag === "LocalBranch"
    ? refs.branches.find((branch) => branch.name === row.name)
    : undefined;
}

export function branchStartPoint(
  row: BranchesSidebarRefRow,
  refs: RepositoryRefs,
): BranchStartPoint | undefined {
  const target = row.target;
  switch (target._tag) {
    case "LocalBranch": {
      const oid = localBranch(row, refs)?.target;
      return oid === undefined
        ? undefined
        : { label: target.name, name: "", oid };
    }
    case "RemoteBranch": {
      const oid = refs.remoteBranches.find(
        (branch) =>
          branch.remote === target.remote && branch.name === target.name,
      )?.target;
      return oid === undefined
        ? undefined
        : {
            label: `${target.remote}/${target.name}`,
            name: target.name,
            oid,
            track: { name: target.name, remote: target.remote },
          };
    }
    case "Tag": {
      const oid = refs.tags.find((tag) => tag.name === target.name)?.target;
      return oid === undefined
        ? undefined
        : { label: target.name, name: "", oid };
    }
  }
}

function remoteBranch(
  row: BranchesSidebarRefRow,
  refs: RepositoryRefs,
): RemoteBranch | undefined {
  const target = row.target;
  return target._tag === "RemoteBranch"
    ? refs.remoteBranches.find(
        ({ name, remote }) => remote === target.remote && name === target.name,
      )
    : undefined;
}

function trackedRemoteBranch(
  branch: LocalBranch,
  refs: RepositoryRefs,
): RemoteBranch | undefined {
  if (branch.upstream === undefined || branch.upstream.gone) return undefined;
  return refs.remoteBranches.find(
    ({ name, remote }) =>
      name === branch.name && `${remote}/${name}` === branch.upstream?.name,
  );
}

export function upstreamTarget(
  refs: RepositoryRefs,
  upstreamName: string | undefined,
): BranchUpstreamTarget | undefined {
  const branch = refs.remoteBranches.find(
    ({ name, remote }) => `${remote}/${name}` === upstreamName,
  );
  return branch === undefined
    ? undefined
    : { name: branch.name, remote: branch.remote };
}

function action(
  id: BranchRowActionId,
  group: BranchRowAction["group"],
  label: string,
  options: {
    readonly disabledReason?: string | undefined;
    readonly shortcut?: string;
  },
): BranchRowAction {
  return {
    group,
    id,
    label,
    ...(options.disabledReason === undefined
      ? {}
      : { disabledReason: options.disabledReason }),
    ...(options.shortcut === undefined ? {} : { shortcut: options.shortcut }),
  };
}
