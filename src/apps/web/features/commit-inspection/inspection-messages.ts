import type { CommitInspectionHttpApi } from "@rebase/contracts";
import type { EnvironmentRouteFailure } from "@rebase/environment-client";

type InspectionRoute =
  | typeof CommitInspectionHttpApi.inspect
  | typeof CommitInspectionHttpApi.inspectDiff;

export function describeInspectionFailure(
  error: EnvironmentRouteFailure<InspectionRoute>,
) {
  return error._tag === "EnvironmentHttpRejected"
    ? error.failure.detail
    : "Could not load this commit. Check the environment connection and try again.";
}
