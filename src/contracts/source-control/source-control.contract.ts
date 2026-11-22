import { z } from "zod";
import { route } from "#contracts/environment-connection/environment-route.contract.ts";
import { IsoDate } from "#contracts/environment-connection/iso-date.contract.ts";
import { RemoteUrl } from "#contracts/git/git-values.contract.ts";

export const GitHostKind = z.enum([
  "github",
  "gitlab",
  "azure-devops",
  "bitbucket",
  "forgejo",
]);
export type GitHostKind = z.infer<typeof GitHostKind>;

const ToolVersion = z.string().max(256);
const HostText = z.string().max(256);
const HostAccount = z.object({ host: HostText, account: HostText });

export const bitbucketApiTokenScopes = [
  "read:repository:bitbucket",
  "read:pullrequest:bitbucket",
  "read:user:bitbucket",
  "read:workspace:bitbucket",
] as const;

export const BitbucketToken = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("AccessToken") }),
  z.object({
    _tag: z.literal("ApiToken"),
    email: HostText,
    account: HostText,
    missingScopes: z.array(z.enum(bitbucketApiTokenScopes)).readonly(),
  }),
]);
export type BitbucketToken = z.infer<typeof BitbucketToken>;

const Secret = z
  .string()
  .regex(/^[\x21-\x7e]+$/)
  .max(4_096);

export const BitbucketTokenRejected = z.object({
  _tag: z.literal("BitbucketTokenRejected"),
  reason: z.enum(["Invalid", "MissingScope", "Unreachable"]),
});
export type BitbucketTokenRejected = z.infer<typeof BitbucketTokenRejected>;

export const GitStatus = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("Available"), version: ToolVersion }),
  z.object({ _tag: z.literal("Missing") }),
]);
export type GitStatus = z.infer<typeof GitStatus>;

export const GitHostStatus = z.discriminatedUnion("_tag", [
  z.object({
    _tag: z.literal("Missing"),
    kind: GitHostKind,
    enabled: z.boolean(),
  }),
  z.object({
    _tag: z.literal("SignedOut"),
    kind: GitHostKind,
    enabled: z.boolean(),
    version: ToolVersion,
  }),
  z.object({
    _tag: z.literal("SignedIn"),
    kind: GitHostKind,
    enabled: z.boolean(),
    version: ToolVersion,
    accounts: z.array(HostAccount).min(1).max(16).readonly(),
  }),
  z.object({
    _tag: z.literal("Token"),
    kind: GitHostKind,
    enabled: z.boolean(),
    saved: BitbucketToken.nullable(),
  }),
]);
export type GitHostStatus = z.infer<typeof GitHostStatus>;

export const CloneableRepository = z.object({
  name: HostText,
  url: RemoteUrl,
  private: z.boolean(),
  description: z.string().max(1_024).exactOptional(),
  updatedAt: IsoDate.exactOptional(),
});
export type CloneableRepository = z.infer<typeof CloneableRepository>;

export const HostRepositories = z.object({
  kind: GitHostKind,
  host: HostText,
  account: HostText,
  repositories: z.array(CloneableRepository).max(1_000).readonly(),
});
export type HostRepositories = z.infer<typeof HostRepositories>;

export const SourceControlApi = {
  discover: route("source-control/discover", {
    success: z.object({
      git: GitStatus,
      lfs: GitStatus,
      hosts: z.array(GitHostStatus).max(16).readonly(),
    }),
  }),
  cloneable: route("source-control/cloneable", {
    success: z.array(HostRepositories).max(64).readonly(),
  }),
  setHostEnabled: route("source-control/set-host-enabled", {
    request: z.object({ kind: GitHostKind, enabled: z.boolean() }),
    success: z.void(),
  }),
  saveBitbucketToken: route("source-control/save-bitbucket-token", {
    request: z.discriminatedUnion("_tag", [
      z.object({ _tag: z.literal("AccessToken"), token: Secret }),
      z.object({ _tag: z.literal("ApiToken"), email: HostText, token: Secret }),
    ]),
    success: z.void(),
    failure: BitbucketTokenRejected,
  }),
  removeBitbucketToken: route("source-control/remove-bitbucket-token", {
    success: z.void(),
  }),
};
