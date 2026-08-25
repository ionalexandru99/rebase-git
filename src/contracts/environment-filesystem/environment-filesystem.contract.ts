import { EnvironmentGrantHttpFailure } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import { Schema } from "effect";

const EnvironmentPath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4_096),
);
const EntryName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
);
const EntryKind = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(32),
);
const IsoDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
);

export const ListEnvironmentDirectory = Schema.Struct({
  includeHidden: Schema.optional(Schema.Boolean),
  path: Schema.optional(EnvironmentPath),
});
export type ListEnvironmentDirectory = typeof ListEnvironmentDirectory.Type;

export const EnvironmentPathBreadcrumb = Schema.Struct({
  name: EntryName,
  path: EnvironmentPath,
});
export type EnvironmentPathBreadcrumb = typeof EnvironmentPathBreadcrumb.Type;

export const EnvironmentDirectoryEntry = Schema.Struct({
  kind: EntryKind,
  modifiedAt: Schema.optional(IsoDate),
  name: EntryName,
  path: EnvironmentPath,
  type: Schema.Literals(["directory", "file"]),
});
export type EnvironmentDirectoryEntry = typeof EnvironmentDirectoryEntry.Type;

export const EnvironmentDirectory = Schema.Struct({
  breadcrumbs: Schema.Array(EnvironmentPathBreadcrumb).check(
    Schema.isMaxLength(256),
  ),
  entries: Schema.Array(EnvironmentDirectoryEntry).check(
    Schema.isMaxLength(500),
  ),
  parentPath: Schema.optional(EnvironmentPath),
  path: EnvironmentPath,
  truncated: Schema.Boolean,
});
export type EnvironmentDirectory = typeof EnvironmentDirectory.Type;

export const EnvironmentDirectoryRejected = Schema.TaggedStruct(
  "EnvironmentDirectoryRejected",
  {
    reason: Schema.Literals([
      "MalformedPath",
      "NotFound",
      "NotDirectory",
      "PermissionDenied",
      "InspectionFailed",
    ]),
  },
);
export type EnvironmentDirectoryRejected =
  typeof EnvironmentDirectoryRejected.Type;

export const EnvironmentFilesystemHttpFailure = Schema.Union([
  EnvironmentGrantHttpFailure,
  EnvironmentDirectoryRejected,
]);
export type EnvironmentFilesystemHttpFailure =
  typeof EnvironmentFilesystemHttpFailure.Type;

export const environmentDirectoryPath = "/api/filesystem/directory";

export const EnvironmentFilesystemHttpApi = {
  listDirectory: {
    failure: EnvironmentFilesystemHttpFailure,
    failureStatuses: [400, 401, 403, 404, 410, 413, 422] as const,
    method: "POST",
    path: environmentDirectoryPath,
    request: ListEnvironmentDirectory,
    success: EnvironmentDirectory,
    successStatus: 200,
  },
} as const;
