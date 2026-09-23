import { EnvironmentGrantHttpFailure } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import type { EnvironmentHttpRoute } from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import { IsoDate } from "@rebase/contracts/environment-connection/iso-date.contract";
import { RepositoryMissing } from "@rebase/contracts/git/git-failures.contract";
import {
  RepositoryId,
  RepositoryPath,
} from "@rebase/contracts/git/git-values.contract";
import { Schema } from "effect";

const RepositoryName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
);

export const RepositoryCatalogEntry = Schema.Struct({
  addedAt: IsoDate,
  id: RepositoryId,
  lastOpenedAt: IsoDate,
  logicalRepositoryId: Schema.optionalKey(RepositoryId),
  name: RepositoryName,
  path: RepositoryPath,
});
export type RepositoryCatalogEntry = typeof RepositoryCatalogEntry.Type;

export const RepositoryCatalog = Schema.Struct({
  repositories: Schema.Array(RepositoryCatalogEntry).check(
    Schema.isMaxLength(10_000),
  ),
});
export type RepositoryCatalog = typeof RepositoryCatalog.Type;

export const RememberRepository = Schema.Struct({
  path: RepositoryPath,
});
export type RememberRepository = typeof RememberRepository.Type;

export const RecordRepositoryOpened = Schema.Struct({
  repositoryId: RepositoryId,
});
export type RecordRepositoryOpened = typeof RecordRepositoryOpened.Type;

export const RemoveRepository = Schema.Struct({
  repositoryId: RepositoryId,
});
export type RemoveRepository = typeof RemoveRepository.Type;

export const RepositoryRemoved = Schema.Struct({
  repositoryId: RepositoryId,
});
export type RepositoryRemoved = typeof RepositoryRemoved.Type;

export const RepositoryPathRejected = Schema.TaggedStruct(
  "RepositoryPathRejected",
  {
    reason: Schema.Literals([
      "MalformedPath",
      "NotFound",
      "NotDirectory",
      "NotRepository",
      "InspectionFailed",
    ]),
  },
);
export type RepositoryPathRejected = typeof RepositoryPathRejected.Type;

export const RepositoryCatalogOperationFailure = Schema.Union([
  RepositoryPathRejected,
  RepositoryMissing,
]);
export type RepositoryCatalogOperationFailure =
  typeof RepositoryCatalogOperationFailure.Type;

export const RepositoryCatalogHttpFailure = Schema.Union([
  EnvironmentGrantHttpFailure,
  RepositoryCatalogOperationFailure,
]);
export type RepositoryCatalogHttpFailure =
  typeof RepositoryCatalogHttpFailure.Type;

export const repositoryCatalogPath = "/api/repositories";
export const rememberRepositoryPath = "/api/repositories/remember";
export const recordRepositoryOpenedPath = "/api/repositories/opened";
export const removeRepositoryPath = "/api/repositories/removals";

export const RepositoryCatalogHttpApi = {
  list: {
    capability: "repository.read",
    failure: EnvironmentGrantHttpFailure,
    failureStatuses: [400, 401, 403, 410, 413],
    method: "GET",
    path: repositoryCatalogPath,
    success: RepositoryCatalog,
    successStatus: 200,
  },
  recordOpened: {
    capability: "repository.read",
    failure: RepositoryCatalogHttpFailure,
    failureStatuses: [400, 401, 403, 404, 410, 413, 422],
    method: "POST",
    path: recordRepositoryOpenedPath,
    request: RecordRepositoryOpened,
    success: RepositoryCatalogEntry,
    successStatus: 200,
  },
  remember: {
    capability: "repository.write",
    failure: RepositoryCatalogHttpFailure,
    failureStatuses: [400, 401, 403, 404, 410, 413, 422],
    method: "POST",
    path: rememberRepositoryPath,
    request: RememberRepository,
    success: RepositoryCatalogEntry,
    successStatus: 201,
  },
  remove: {
    capability: "repository.write",
    failure: RepositoryCatalogHttpFailure,
    failureStatuses: [400, 401, 403, 404, 410, 413, 422],
    method: "POST",
    path: removeRepositoryPath,
    request: RemoveRepository,
    success: RepositoryRemoved,
    successStatus: 200,
  },
} as const satisfies Record<string, EnvironmentHttpRoute>;
