import { CommitInspectionHttpApi } from "@rebase/contracts";
import { httpRoute } from "#server/adapters/environment-transport/http/environment-http-route-handler";
import type { EnvironmentHttpRouteHandler } from "#server/adapters/environment-transport/http/environment-http-route-handler.contract";
import type {
  CommitInspectionError,
  CommitInspectionService,
} from "#server/domain/commit-inspection.contract";

export function commitInspectionHttpRoutes(
  inspection: CommitInspectionService,
): readonly EnvironmentHttpRouteHandler[] {
  const api = CommitInspectionHttpApi;
  return [
    httpRoute(api.inspect, (command) => inspection.inspect(command), {
      failureStatus,
    }),
    httpRoute(api.inspectDiff, (command) => inspection.inspectDiff(command), {
      failureStatus,
    }),
  ];
}

function failureStatus(error: CommitInspectionError) {
  return error.failure.reason === "Missing" ? 404 : 409;
}
