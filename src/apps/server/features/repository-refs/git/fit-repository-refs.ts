import {
  maximumJsonMessageBytes,
  type RepositoryRefs,
} from "@rebase/contracts";

const responseSizeMargin = 512;

export function fitRepositoryRefs(refs: RepositoryRefs): RepositoryRefs {
  const budget = maximumJsonMessageBytes - responseSizeMargin;
  const emptied: RepositoryRefs = {
    ...refs,
    branches: [],
    remoteBranches: [],
    tags: [],
    truncated: { branches: true, remoteBranches: true, tags: true },
  };
  let encodedBytes = Buffer.byteLength(JSON.stringify(emptied));
  const fit = <Entry>(entries: readonly Entry[]) => {
    const fitted: Entry[] = [];
    for (const entry of entries) {
      const entryBytes =
        Buffer.byteLength(JSON.stringify(entry)) +
        (fitted.length === 0 ? 0 : 1);
      if (encodedBytes + entryBytes > budget) break;
      fitted.push(entry);
      encodedBytes += entryBytes;
    }
    return fitted;
  };

  const branches = fit(refs.branches.slice(0, 10_000));
  const remoteBranches = fit(refs.remoteBranches.slice(0, 20_000));
  const tags = fit(refs.tags.slice(0, 10_000));
  return {
    ...refs,
    branches,
    remoteBranches,
    tags,
    truncated: {
      branches: branches.length < refs.branches.length,
      remoteBranches: remoteBranches.length < refs.remoteBranches.length,
      tags: tags.length < refs.tags.length,
    },
  };
}
