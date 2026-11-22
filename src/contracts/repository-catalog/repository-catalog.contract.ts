import { z } from "zod";
import { route } from "#contracts/environment-connection/environment-route.contract.ts";
import { IsoDate } from "#contracts/environment-connection/iso-date.contract.ts";
import { RepositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  RefName,
  RemoteUrl,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

const RepositoryName = z.string().min(1).max(255);

export const RepositoryColor = z.enum([
  "blue",
  "green",
  "violet",
  "orange",
  "lime",
  "cyan",
  "red",
  "amber",
]);
export type RepositoryColor = z.infer<typeof RepositoryColor>;

export const RepositoryCatalogEntry = z.object({
  addedAt: IsoDate,
  color: RepositoryColor,
  id: RepositoryId,
  lastOpenedAt: IsoDate,
  logicalRepositoryId: RepositoryId.exactOptional(),
  name: RepositoryName,
  path: RepositoryPath,
});
export type RepositoryCatalogEntry = z.infer<typeof RepositoryCatalogEntry>;

export const RepositoryCatalog = z.object({
  repositories: z.array(RepositoryCatalogEntry).max(10_000).readonly(),
});
export type RepositoryCatalog = z.infer<typeof RepositoryCatalog>;

export const RememberRepository = z.object({
  path: RepositoryPath,
});
export type RememberRepository = z.infer<typeof RememberRepository>;

export const RecordRepositoryOpened = z.object({
  repositoryId: RepositoryId,
});
export type RecordRepositoryOpened = z.infer<typeof RecordRepositoryOpened>;

export const RemoveRepository = z.object({
  repositoryId: RepositoryId,
});
export type RemoveRepository = z.infer<typeof RemoveRepository>;

export const RepositoryRemoved = z.object({
  repositoryId: RepositoryId,
});
export type RepositoryRemoved = z.infer<typeof RepositoryRemoved>;

export const RepositoryPathRejected = z.object({
  _tag: z.literal("RepositoryPathRejected"),
  reason: z.enum([
    "MalformedPath",
    "NotFound",
    "NotDirectory",
    "NotRepository",
    "InspectionFailed",
  ]),
});
export type RepositoryPathRejected = z.infer<typeof RepositoryPathRejected>;

export const RepositoryDefaults = z.object({
  cloneFolder: RepositoryPath,
  initialBranch: RefName,
});
export type RepositoryDefaults = z.infer<typeof RepositoryDefaults>;

export const CloneRepository = z.object({
  repositoryId: RepositoryId,
  url: RemoteUrl,
  path: RepositoryPath,
});
export type CloneRepository = z.infer<typeof CloneRepository>;

export const InitializeRepository = z.object({
  path: RepositoryPath,
  branch: RefName,
});
export type InitializeRepository = z.infer<typeof InitializeRepository>;

export const RepositoryNotCreated = z.object({
  _tag: z.literal("RepositoryNotCreated"),
  reason: z.enum([
    "MalformedPath",
    "DestinationNotEmpty",
    "InsideRepository",
    "GitFailed",
  ]),
  detail: z.string().max(2_048).exactOptional(),
  leftover: RepositoryPath.exactOptional(),
});
export type RepositoryNotCreated = z.infer<typeof RepositoryNotCreated>;

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
  defaults: route("repositories/defaults", {
    success: RepositoryDefaults,
  }),
  setCloneFolder: route("repositories/set-clone-folder", {
    request: z.object({ path: RepositoryPath }),
    success: z.void(),
    failure: RepositoryPathRejected,
  }),
  clone: route("repositories/clone", {
    request: CloneRepository,
    success: RepositoryCatalogEntry,
    failure: RepositoryNotCreated,
  }),
  initialize: route("repositories/initialize", {
    request: InitializeRepository,
    success: RepositoryCatalogEntry,
    failure: RepositoryNotCreated,
  }),
  remove: route("repositories/remove", {
    request: RemoveRepository,
    success: RepositoryRemoved,
    failure: RepositoryRejected,
  }),
};
