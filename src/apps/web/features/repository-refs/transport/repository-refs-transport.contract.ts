import type {
  JsonMessageFragment,
  RepositoryRefs,
  RepositoryRefsFailed,
} from "@rebase/contracts";
import type { Effect } from "effect";
import type { EnvironmentConnectionFailure } from "#web/features/environment-connection/environment-connection-errors";
import type { RepositoryRefsClientError } from "#web/features/repository-refs/repository-refs-client.contract";

export interface RepositoryRefsTransport {
  readonly read: (
    repositoryId: string,
  ) => Effect.Effect<RepositoryRefs, RepositoryRefsClientError>;
}

export interface RepositoryRefsTransportRuntime
  extends RepositoryRefsTransport {
  readonly hasRequest: (requestId: string) => boolean;
  readonly acceptJson: (
    frame: JsonMessageFragment,
  ) => Effect.Effect<void, EnvironmentConnectionFailure>;
  readonly acceptFailure: (
    message: RepositoryRefsFailed,
  ) => Effect.Effect<void>;
  readonly close: Effect.Effect<void>;
}
