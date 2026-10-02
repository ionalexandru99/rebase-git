import { Schema } from "effect";
import { route } from "#contracts/environment-connection/environment-route.contract.ts";

export const GitHostKind = Schema.Literals([
  "github",
  "gitlab",
  "azure-devops",
  "bitbucket",
  "forgejo",
]);
export type GitHostKind = typeof GitHostKind.Type;

const ToolVersion = Schema.String.check(Schema.isMaxLength(256));
const Account = Schema.String.check(Schema.isMaxLength(256));

export const GitStatus = Schema.Union([
  Schema.TaggedStruct("Available", { version: ToolVersion }),
  Schema.TaggedStruct("Missing", {}),
]);
export type GitStatus = typeof GitStatus.Type;

export const GitHostStatus = Schema.Union([
  Schema.TaggedStruct("ComingSoon", { kind: GitHostKind }),
  Schema.TaggedStruct("Missing", {
    kind: GitHostKind,
    enabled: Schema.Boolean,
  }),
  Schema.TaggedStruct("SignedOut", {
    kind: GitHostKind,
    enabled: Schema.Boolean,
    version: ToolVersion,
  }),
  Schema.TaggedStruct("SignedIn", {
    kind: GitHostKind,
    enabled: Schema.Boolean,
    version: ToolVersion,
    account: Account,
  }),
]);
export type GitHostStatus = typeof GitHostStatus.Type;

export const SourceControlApi = {
  discover: route("source-control/discover", {
    success: Schema.Struct({
      git: GitStatus,
      hosts: Schema.Array(GitHostStatus).check(Schema.isMaxLength(16)),
    }),
  }),
  setHostEnabled: route("source-control/set-host-enabled", {
    request: Schema.Struct({ kind: GitHostKind, enabled: Schema.Boolean }),
    success: Schema.Void,
  }),
};
