import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import type { CommitInspectionService } from "#server/domain/commit-inspection.contract";
import { commitInspectionHttpRoutes } from "#server/features/commit-inspection/http/commit-inspection-http-routes";

export function commitInspectionFeature(
  inspection: CommitInspectionService,
): EnvironmentFeature {
  return {
    capabilities: [],
    httpRoutes: commitInspectionHttpRoutes(inspection),
    rpcHandlers: () => ({}),
  };
}
