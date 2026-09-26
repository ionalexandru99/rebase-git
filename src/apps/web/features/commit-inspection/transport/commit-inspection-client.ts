import { CommitInspectionHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type CommitInspectionClient,
  CommitInspectionError,
} from "#web/features/commit-inspection/commit-inspection.contract";

export function commitInspectionClient(
  requests: EnvironmentRequestClient,
): CommitInspectionClient {
  const api = requests(CommitInspectionHttpApi, {
    disconnected: () =>
      new CommitInspectionError({
        message: "Connect to the environment to inspect commits.",
      }),
    response: (error) =>
      new CommitInspectionError({
        message:
          error._tag === "EnvironmentHttpRejected"
            ? error.failure.detail
            : "Could not load this commit. Check the environment connection and try again.",
      }),
  });
  return { inspect: api.inspect, diff: api.inspectDiff };
}
