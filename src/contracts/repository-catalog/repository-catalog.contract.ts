import { EnvironmentGrantHttpFailure } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import { Schema } from "effect";

const RepositoryId = Schema.String.check(Schema.isUUID(4));
const RepositoryName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
);
const NativeRepositoryPath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4_096),
);
const IsoDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
);

export const RepositoryCatalogEntry = Schema.Struct({
  addedAt: IsoDate,
  id: RepositoryId,
  lastOpenedAt: IsoDate,
  logicalRepositoryId: Schema.optionalKey(RepositoryId),
  name: RepositoryName,
  path: NativeRepositoryPath,
});
export type RepositoryCatalogEntry = typeof RepositoryCatalogEntry.Type;

export const RepositoryCatalog = Schema.Struct({
  repositories: Schema.Array(RepositoryCatalogEntry).check(
    Schema.isMaxLength(10_000),
  ),
});
export type RepositoryCatalog = typeof RepositoryCatalog.Type;

export const RememberRepository = Schema.Struct({
  path: NativeRepositoryPath,
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

export const RepositoryMissing = Schema.TaggedStruct("RepositoryMissing", {
  repositoryId: RepositoryId,
});
export type RepositoryMissing = typeof RepositoryMissing.Type;

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
    failure: EnvironmentGrantHttpFailure,
    failureStatuses: [400, 401, 403, 410, 413] as const,
    method: "GET",
    path: repositoryCatalogPath,
    success: RepositoryCatalog,
    successStatus: 200,
  },
  recordOpened: {
    failure: RepositoryCatalogHttpFailure,
    failureStatuses: [400, 401, 403, 404, 410, 413, 422] as const,
    method: "POST",
    path: recordRepositoryOpenedPath,
    request: RecordRepositoryOpened,
    success: RepositoryCatalogEntry,
    successStatus: 200,
  },
  remember: {
    failure: RepositoryCatalogHttpFailure,
    failureStatuses: [400, 401, 403, 404, 410, 413, 422] as const,
    method: "POST",
    path: rememberRepositoryPath,
    request: RememberRepository,
    success: RepositoryCatalogEntry,
    successStatus: 201,
  },
  remove: {
    failure: RepositoryCatalogHttpFailure,
    failureStatuses: [400, 401, 403, 404, 410, 413, 422] as const,
    method: "POST",
    path: removeRepositoryPath,
    request: RemoveRepository,
    success: RepositoryRemoved,
    successStatus: 200,
  },
} as const;
