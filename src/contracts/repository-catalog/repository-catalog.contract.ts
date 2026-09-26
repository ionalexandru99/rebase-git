import {
  type EnvironmentHttpRoute,
  route,
} from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import { IsoDate } from "@rebase/contracts/environment-connection/iso-date.contract";
import { RepositoryRejected } from "@rebase/contracts/git/git-failures.contract";
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

export const repositoryCatalogPath = "/api/repositories";
export const rememberRepositoryPath = "/api/repositories/remember";
export const recordRepositoryOpenedPath = "/api/repositories/opened";
export const removeRepositoryPath = "/api/repositories/removals";

export const RepositoryCatalogHttpApi = {
  list: route({
    capability: "repository.read",
    method: "GET",
    path: repositoryCatalogPath,
    success: RepositoryCatalog,
  }),
  recordOpened: route({
    capability: "repository.read",
    method: "POST",
    path: recordRepositoryOpenedPath,
    request: RecordRepositoryOpened,
    success: RepositoryCatalogEntry,
    failure: RepositoryRejected,
  }),
  remember: route({
    capability: "repository.write",
    method: "POST",
    path: rememberRepositoryPath,
    request: RememberRepository,
    success: RepositoryCatalogEntry,
    failure: RepositoryPathRejected,
  }),
  remove: route({
    capability: "repository.write",
    method: "POST",
    path: removeRepositoryPath,
    request: RemoveRepository,
    success: RepositoryRemoved,
    failure: RepositoryRejected,
  }),
} satisfies Record<string, EnvironmentHttpRoute>;
