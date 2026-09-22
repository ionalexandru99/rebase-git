import { CommitInspectionHttpApi } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import { ChangesHttpFailure } from "@rebase/contracts/repository-changes/repository-changes.contract";
import {
  type CommitInspectionClient,
  CommitInspectionError,
} from "#web/features/commit-inspection/commit-inspection.contract";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import { createEnvironmentJsonClient } from "#web/features/environment-connection/index";

export function createCommitInspectionClient(
  origin: string,
  credential: () => EnvironmentCredential | undefined,
): CommitInspectionClient {
  const request = createEnvironmentJsonClient(
    origin,
    credential,
    ChangesHttpFailure,
    {
      disconnected: () =>
        new CommitInspectionError({
          message: "Connect to the environment to inspect commits.",
        }),
      response: (error) =>
        new CommitInspectionError({
          message:
            error._tag === "EnvironmentHttpRejected" &&
            error.failure._tag === "ChangesFailed"
              ? error.failure.detail
              : "Could not load this commit. Check the environment connection and try again.",
        }),
    },
  );
  const api = CommitInspectionHttpApi;
  return {
    inspect: (command) => request(api.inspect, command),
    diff: (command) => request(api.inspectDiff, command),
  };
}
