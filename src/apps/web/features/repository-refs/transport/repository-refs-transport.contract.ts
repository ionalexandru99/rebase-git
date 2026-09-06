import type { RepositoryRefs } from "@rebase/contracts";
import type { Effect } from "effect";
import type { RepositoryRefsClientError } from "#web/features/repository-refs/repository-refs-client.contract";

export interface RepositoryRefsTransport {
  readonly read: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryRefs, RepositoryRefsClientError>;
}
