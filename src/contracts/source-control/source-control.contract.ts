import { Schema } from "effect";
import { route } from "#contracts/environment-connection/environment-route.contract.ts";
import { IsoDate } from "#contracts/environment-connection/iso-date.contract.ts";
import { RemoteUrl } from "#contracts/git/git-values.contract.ts";

export const GitHostKind = Schema.Literals([
  "github",
  "gitlab",
  "azure-devops",
  "bitbucket",
  "forgejo",
]);
export type GitHostKind = typeof GitHostKind.Type;

const ToolVersion = Schema.String.check(Schema.isMaxLength(256));
const HostText = Schema.String.check(Schema.isMaxLength(256));
const HostAccount = Schema.Struct({ host: HostText, account: HostText });

export const bitbucketApiTokenScopes = [
  "read:repository:bitbucket",
  "read:pullrequest:bitbucket",
  "read:user:bitbucket",
  "read:workspace:bitbucket",
] as const;

export const BitbucketToken = Schema.Union([
  Schema.TaggedStruct("AccessToken", {}),
  Schema.TaggedStruct("ApiToken", {
    email: HostText,
    account: HostText,
    missingScopes: Schema.Array(Schema.Literals(bitbucketApiTokenScopes)),
  }),
]);
export type BitbucketToken = typeof BitbucketToken.Type;

const Secret = Schema.String.check(
  Schema.isPattern(/^[\x21-\x7e]+$/),
  Schema.isMaxLength(4_096),
);

export const BitbucketTokenRejected = Schema.TaggedStruct(
  "BitbucketTokenRejected",
  { reason: Schema.Literals(["Invalid", "MissingScope", "Unreachable"]) },
);
export type BitbucketTokenRejected = typeof BitbucketTokenRejected.Type;

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
    accounts: Schema.Array(HostAccount).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(16),
    ),
  }),
  Schema.TaggedStruct("Token", {
    kind: GitHostKind,
    enabled: Schema.Boolean,
    saved: Schema.NullOr(BitbucketToken),
  }),
]);
export type GitHostStatus = typeof GitHostStatus.Type;

export const CloneableRepository = Schema.Struct({
  name: HostText,
  url: RemoteUrl,
  private: Schema.Boolean,
  description: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(1_024)),
  ),
  updatedAt: Schema.optionalKey(IsoDate),
});
export type CloneableRepository = typeof CloneableRepository.Type;

export const HostRepositories = Schema.Struct({
  kind: GitHostKind,
  host: HostText,
  account: HostText,
  repositories: Schema.Array(CloneableRepository).check(
    Schema.isMaxLength(1_000),
  ),
});
export type HostRepositories = typeof HostRepositories.Type;

export const SourceControlApi = {
  discover: route("source-control/discover", {
    success: Schema.Struct({
      git: GitStatus,
      hosts: Schema.Array(GitHostStatus).check(Schema.isMaxLength(16)),
    }),
  }),
  cloneable: route("source-control/cloneable", {
    success: Schema.Array(HostRepositories).check(Schema.isMaxLength(64)),
  }),
  setHostEnabled: route("source-control/set-host-enabled", {
    request: Schema.Struct({ kind: GitHostKind, enabled: Schema.Boolean }),
    success: Schema.Void,
  }),
  saveBitbucketToken: route("source-control/save-bitbucket-token", {
    request: Schema.Union([
      Schema.TaggedStruct("AccessToken", { token: Secret }),
      Schema.TaggedStruct("ApiToken", { email: HostText, token: Secret }),
    ]),
    success: Schema.Void,
    failure: BitbucketTokenRejected,
  }),
  removeBitbucketToken: route("source-control/remove-bitbucket-token", {
    success: Schema.Void,
  }),
};
