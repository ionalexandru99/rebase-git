import { currentTransportLimits, type RepositoryRefs } from "@rebase/contracts";

const responseSizeMargin = 512;

export function fitRepositoryRefs(refs: RepositoryRefs): RepositoryRefs {
  const budget =
    currentTransportLimits.maxHttpResponseBytes - responseSizeMargin;
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

  const branches = fit(refs.branches);
  const remoteBranches = fit(refs.remoteBranches);
  const tags = fit(refs.tags);
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
