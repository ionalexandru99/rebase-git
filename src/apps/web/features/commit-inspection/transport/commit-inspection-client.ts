import { CommitInspectionHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type CommitInspectionClient,
  CommitInspectionError,
} from "#web/features/commit-inspection/commit-inspection.contract";
import { effectRoutesClient } from "#web/platform/environment/effect-routes-client";

export function commitInspectionClient(
  requests: EnvironmentRequestClient,
): CommitInspectionClient {
  const api = effectRoutesClient(
    requests,
    CommitInspectionHttpApi,
    (error) =>
      new CommitInspectionError({
        message:
          error._tag === "EnvironmentHttpRejected"
            ? error.failure.detail
            : "Could not load this commit. Check the environment connection and try again.",
      }),
  );
  return { inspect: api.inspect, diff: api.inspectDiff };
}
