import { Schema } from "effect";
import { route } from "#contracts/environment-connection/environment-route.contract.ts";
import { IsoDate } from "#contracts/environment-connection/iso-date.contract.ts";
import { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

const RepositoryName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
);

export const RepositoryColor = Schema.Literals([
  "blue",
  "green",
  "violet",
  "orange",
  "lime",
  "cyan",
  "red",
  "amber",
]);
export type RepositoryColor = typeof RepositoryColor.Type;

export const RepositoryCatalogEntry = Schema.Struct({
  addedAt: IsoDate,
  color: RepositoryColor,
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

export const RepositoryCatalogApi = {
  list: route("repositories/list", {
    success: RepositoryCatalog,
  }),
  recordOpened: route("repositories/opened", {
    request: RecordRepositoryOpened,
    success: RepositoryCatalogEntry,
    failure: RepositoryRejected,
  }),
  remember: route("repositories/remember", {
    request: RememberRepository,
    success: RepositoryCatalogEntry,
    failure: RepositoryPathRejected,
  }),
  remove: route("repositories/remove", {
    request: RemoveRepository,
    success: RepositoryRemoved,
    failure: RepositoryRejected,
  }),
};
