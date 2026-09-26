import {
  type EnvironmentHttpRoute,
  route,
} from "@rebase/contracts/environment-connection/http/environment-http-route.contract";
import { IsoDate } from "@rebase/contracts/environment-connection/iso-date.contract";
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

export const environmentDirectoryPath = "/api/filesystem/directory";

export const EnvironmentFilesystemHttpApi = {
  listDirectory: route({
    capability: "repository.write",
    method: "POST",
    path: environmentDirectoryPath,
    request: ListEnvironmentDirectory,
    success: EnvironmentDirectory,
    failure: EnvironmentDirectoryRejected,
  }),
} satisfies Record<string, EnvironmentHttpRoute>;
