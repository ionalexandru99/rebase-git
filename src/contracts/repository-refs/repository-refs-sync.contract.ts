import { EnvironmentRequestId } from "@rebase/contracts/environment-connection/negotiation/environment-protocol.contract";
import { AuthorizationDenied } from "@rebase/contracts/environment-connection/rpc/environment-rpc-failure.contract";
import { RepositoryRejected } from "@rebase/contracts/git/git-failures.contract";
import { RepositoryId } from "@rebase/contracts/git/git-values.contract";
import { Schema } from "effect";

export const ReadRepositoryRefsMessage = Schema.TaggedStruct(
  "ReadRepositoryRefs",
  {
    repositoryId: RepositoryId,
    requestId: EnvironmentRequestId,
  },
);
export const RepositoryRefsFailed = Schema.TaggedStruct(
  "RepositoryRefsFailed",
  {
    failure: Schema.Union([RepositoryRejected, AuthorizationDenied]),
    requestId: EnvironmentRequestId,
  },
);
export type RepositoryRefsFailed = typeof RepositoryRefsFailed.Type;
