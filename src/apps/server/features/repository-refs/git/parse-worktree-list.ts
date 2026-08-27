import type { RepositoryWorktree } from "@rebase/contracts";

const branchPrefix = "refs/heads/";

export function parseWorktreeList(
  stdout: string,
): readonly RepositoryWorktree[] {
  return splitWorktreeEntries(stdout).flatMap((entry, index) => {
    const worktree = worktreeFromEntry(entry, index === 0);
    return worktree === undefined ? [] : [worktree];
  });
}

function splitWorktreeEntries(stdout: string): readonly (readonly string[])[] {
  const entries: string[][] = [];
  let current: string[] = [];
  for (const line of stdout.split("\0")) {
    if (line.length === 0) {
      if (current.length > 0) entries.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) entries.push(current);
  return entries;
}

function worktreeFromEntry(
  entry: readonly string[],
  main: boolean,
): RepositoryWorktree | undefined {
  const fields = new Map(
    entry.map((line) => {
      const separator = line.indexOf(" ");
      return separator < 0
        ? [line, ""]
        : [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
  const path = fields.get("worktree");
  const commit = fields.get("HEAD");
  if (path === undefined || commit === undefined || fields.has("bare")) {
    return undefined;
  }
  const branch = fields.get("branch");
  return {
    head: {
      ...(branch?.startsWith(branchPrefix)
        ? { branch: branch.slice(branchPrefix.length) }
        : {}),
      commit,
    },
    main,
    path,
  };
}
