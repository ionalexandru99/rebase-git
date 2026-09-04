import type { RepositoryRefs } from "@rebase/contracts";
import { useEffect, useMemo, useState } from "react";
import {
  cacheRepositoryRefs,
  readCachedRepositoryRefs,
} from "#web/features/repository-refs/browser-repository-refs-cache";
import type { RepositoryRefsSnapshot } from "#web/features/repository-refs/repository-refs-controller.contract";

export function useCachedRepositoryRefs(
  environmentId: string | undefined,
  logicalRepositoryId: string | undefined,
  repositoryId: string | undefined,
  live: RepositoryRefsSnapshot,
) {
  const key = JSON.stringify([environmentId, logicalRepositoryId]);
  const [cached, setCached] = useState<{
    readonly key: string;
    readonly refs: RepositoryRefs;
  }>();
  const currentRefs =
    live.refs?.repositoryId === repositoryId ? live.refs : undefined;

  useEffect(() => {
    if (environmentId === undefined || logicalRepositoryId === undefined)
      return;
    let active = true;
    void readCachedRepositoryRefs(environmentId, logicalRepositoryId).then(
      (refs) => {
        if (active && refs !== undefined) setCached({ key, refs });
      },
    );
    return () => {
      active = false;
    };
  }, [environmentId, logicalRepositoryId, key]);

  useEffect(() => {
    if (
      environmentId !== undefined &&
      logicalRepositoryId !== undefined &&
      currentRefs !== undefined
    ) {
      void cacheRepositoryRefs(environmentId, logicalRepositoryId, currentRefs);
    }
  }, [environmentId, logicalRepositoryId, currentRefs]);

  return useMemo(() => {
    if (
      currentRefs !== undefined ||
      cached?.key !== key ||
      repositoryId === undefined
    ) {
      const { refs: _, ...withoutRefs } = live;
      return {
        restored: false,
        snapshot: currentRefs === undefined ? withoutRefs : live,
      };
    }
    return {
      restored: true,
      snapshot: {
        ...live,
        refs: { ...cached.refs, repositoryId },
        repositoryId,
        status: live.status === "error" ? "error" : "ready",
      } satisfies RepositoryRefsSnapshot,
    };
  }, [cached, currentRefs, key, live, repositoryId]);
}
