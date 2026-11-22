import { z } from "zod";
import { route } from "#contracts/environment-connection/environment-route.contract.ts";
import { IsoDate } from "#contracts/environment-connection/iso-date.contract.ts";

const EnvironmentPath = z.string().min(1).max(4_096);
const EntryName = z.string().min(1).max(255);
const EntryKind = z.string().min(1).max(32);

export const ListEnvironmentDirectory = z.object({
  includeHidden: z.boolean().optional(),
  path: EnvironmentPath.optional(),
});
export type ListEnvironmentDirectory = z.infer<typeof ListEnvironmentDirectory>;

export const EnvironmentPathBreadcrumb = z.object({
  name: EntryName,
  path: EnvironmentPath,
});
export type EnvironmentPathBreadcrumb = z.infer<
  typeof EnvironmentPathBreadcrumb
>;

export const EnvironmentDirectoryEntry = z.object({
  kind: EntryKind,
  modifiedAt: IsoDate.optional(),
  name: EntryName,
  path: EnvironmentPath,
  type: z.enum(["directory", "file"]),
});
export type EnvironmentDirectoryEntry = z.infer<
  typeof EnvironmentDirectoryEntry
>;

export const EnvironmentDirectory = z.object({
  breadcrumbs: z.array(EnvironmentPathBreadcrumb).max(256).readonly(),
  entries: z.array(EnvironmentDirectoryEntry).max(500).readonly(),
  parentPath: EnvironmentPath.optional(),
  path: EnvironmentPath,
  repository: z.boolean(),
  truncated: z.boolean(),
});
export type EnvironmentDirectory = z.infer<typeof EnvironmentDirectory>;

export const EnvironmentDirectoryRejected = z.object({
  _tag: z.literal("EnvironmentDirectoryRejected"),
  reason: z.enum([
    "MalformedPath",
    "NotFound",
    "NotDirectory",
    "PermissionDenied",
    "InspectionFailed",
  ]),
});
export type EnvironmentDirectoryRejected = z.infer<
  typeof EnvironmentDirectoryRejected
>;

export const EnvironmentFilesystemApi = {
  listDirectory: route("filesystem/directory", {
    request: ListEnvironmentDirectory,
    success: EnvironmentDirectory,
    failure: EnvironmentDirectoryRejected,
  }),
};
