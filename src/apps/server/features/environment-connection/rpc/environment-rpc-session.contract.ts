import type {
  EnvironmentAccessCapability,
  HelloAccepted,
  RepositoryHistoryOperationFailure,
} from "@rebase/contracts";
import type { Effect } from "effect";
import type { EnvironmentTransportState } from "#server/features/environment-connection/environment-connection.contract";

export interface EnvironmentRpcSession {
  readonly state: EnvironmentTransportState;
  readonly requireCapability: (
    name: string,
    access?: EnvironmentAccessCapability,
  ) => Effect.Effect<HelloAccepted, RepositoryHistoryOperationFailure>;
}
