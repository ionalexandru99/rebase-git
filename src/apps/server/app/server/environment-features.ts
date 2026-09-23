import { Effect } from "effect";
import { combineEnvironmentFeatures } from "#server/adapters/environment-transport/combine-environment-features";
import { commitInspectionFeature } from "#server/features/commit-inspection/index";
import { environmentAuthorizationFeature } from "#server/features/environment-authorization/index";
import { environmentFilesystemFeature } from "#server/features/environment-filesystem/index";
import { repositoryCatalogFeature } from "#server/features/repository-catalog/index";
import { repositoryChangesFeature } from "#server/features/repository-changes/index";
import {
  repositoryFreshnessFeature,
  repositoryHistoryFeature,
} from "#server/features/repository-history/index";
import { repositoryRefsFeature } from "#server/features/repository-refs/index";

export const environmentFeatures = Effect.map(
  Effect.all([
    environmentAuthorizationFeature,
    environmentFilesystemFeature,
    repositoryCatalogFeature,
    commitInspectionFeature,
    repositoryChangesFeature,
    repositoryHistoryFeature,
    repositoryFreshnessFeature,
    repositoryRefsFeature,
  ]),
  combineEnvironmentFeatures,
);
