import type {
  LocalBranch,
  RemoteDefaultBranch,
  RepositoryHistoryRefTarget,
  RepositoryRefs,
} from "@rebase/contracts";

export function resolveAutomaticHistoryRoots(
  refs: RepositoryRefs,
  activeWorktreePath: string,
) {
  const roots: RepositoryHistoryRefTarget[] = [];
  const activeWorktree = refs.worktrees.find(
    (worktree) => worktree.path === activeWorktreePath,
  );
  const activeBranch = refs.branches.find(
    (branch) => branch.name === activeWorktree?.head.branch,
  );
  if (activeBranch !== undefined && activeWorktree !== undefined) {
    addRoot(roots, {
      name: activeBranch.name,
      oid: activeBranch.target ?? activeWorktree.head.commit,
      type: "branch",
    });
    addUpstream(roots, activeBranch, refs);
  } else if (activeWorktree !== undefined) {
    addRoot(roots, {
      name: "HEAD",
      oid: activeWorktree.head.commit,
      type: "head",
    });
  }

  const defaultBranch = selectRemoteDefault(
    refs.remoteDefaultBranches ?? [],
    activeBranch,
  );
  if (defaultBranch !== undefined) {
    const local = refs.branches.find(
      (branch) => branch.name === defaultBranch.name,
    );
    if (local?.target !== undefined) {
      addRoot(roots, {
        name: local.name,
        oid: local.target,
        type: "branch",
      });
      addUpstream(roots, local, refs);
    } else {
      addRemoteRoot(roots, defaultBranch.remote, defaultBranch.name, refs);
    }
  }
  return roots;
}

function selectRemoteDefault(
  defaults: readonly RemoteDefaultBranch[],
  activeBranch: LocalBranch | undefined,
) {
  const activeRemote = upstreamRemote(activeBranch?.upstream?.name);
  const fromActive = defaults.find(
    (candidate) => candidate.remote === activeRemote,
  );
  if (fromActive !== undefined) return fromActive;
  const origin = defaults.find((candidate) => candidate.remote === "origin");
  if (origin !== undefined) return origin;
  return defaults.length === 1 ? defaults[0] : undefined;
}

function addUpstream(
  roots: RepositoryHistoryRefTarget[],
  branch: LocalBranch,
  refs: RepositoryRefs,
) {
  if (branch.upstream === undefined) return;
  const separator = branch.upstream.name.indexOf("/");
  if (separator <= 0 || separator === branch.upstream.name.length - 1) return;
  addRemoteRoot(
    roots,
    branch.upstream.name.slice(0, separator),
    branch.upstream.name.slice(separator + 1),
    refs,
  );
}

function addRemoteRoot(
  roots: RepositoryHistoryRefTarget[],
  remote: string,
  name: string,
  refs: RepositoryRefs,
) {
  const branch = refs.remoteBranches.find(
    (candidate) => candidate.remote === remote && candidate.name === name,
  );
  if (branch?.target === undefined) return;
  addRoot(roots, {
    name: `${remote}/${name}`,
    oid: branch.target,
    type: "remote-branch",
  });
}

function addRoot(
  roots: RepositoryHistoryRefTarget[],
  root: RepositoryHistoryRefTarget,
) {
  if (
    !roots.some(
      (current) => current.name === root.name && current.type === root.type,
    )
  ) {
    roots.push(root);
  }
}

function upstreamRemote(name: string | undefined) {
  if (name === undefined) return undefined;
  const separator = name.indexOf("/");
  return separator <= 0 ? undefined : name.slice(0, separator);
}
