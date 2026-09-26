import { Effect } from "effect";
import { combineEnvironmentFeatures } from "#server/adapters/environment-transport/combine-environment-features";
import { commitInspectionFeature } from "#server/features/commit-inspection/commit-inspection.feature";
import { environmentAuthorizationFeature } from "#server/features/environment-authorization/environment-authorization.feature";
import { environmentFilesystemFeature } from "#server/features/environment-filesystem/environment-filesystem.feature";
import { repositoryCatalogFeature } from "#server/features/repository-catalog/repository-catalog.feature";
import { repositoryChangesFeature } from "#server/features/repository-changes/repository-changes.feature";
import { repositoryConflictsFeature } from "#server/features/repository-conflicts/repository-conflicts.feature";
import {
  repositoryFreshnessFeature,
  repositoryHistoryFeature,
} from "#server/features/repository-history/repository-history.feature";
import { repositoryOperationsFeature } from "#server/features/repository-operations/repository-operations.feature";
import { repositoryPullFeature } from "#server/features/repository-pull/repository-pull.feature";
import { repositoryPushFeature } from "#server/features/repository-push/repository-push.feature";
import { repositoryRefsFeature } from "#server/features/repository-refs/repository-refs.feature";

export const environmentFeatures = Effect.map(
  Effect.all([
    environmentAuthorizationFeature,
    environmentFilesystemFeature,
    repositoryCatalogFeature,
    commitInspectionFeature,
    repositoryChangesFeature,
    repositoryConflictsFeature,
    repositoryHistoryFeature,
    repositoryFreshnessFeature,
    repositoryOperationsFeature,
    repositoryPullFeature,
    repositoryPushFeature,
    repositoryRefsFeature,
  ]),
  combineEnvironmentFeatures,
);
