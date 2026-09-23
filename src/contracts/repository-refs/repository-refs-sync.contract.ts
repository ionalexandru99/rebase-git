import { CapabilityDenied } from "@rebase/contracts/environment-authorization/environment-authorization.contract";
import { EnvironmentRequestId } from "@rebase/contracts/environment-connection/negotiation/environment-protocol.contract";
import { RepositoryId } from "@rebase/contracts/git/git-values.contract";
import { RepositoryRefsOperationFailure } from "@rebase/contracts/repository-refs/repository-refs.contract";
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
    failure: Schema.Union([RepositoryRefsOperationFailure, CapabilityDenied]),
    requestId: EnvironmentRequestId,
  },
);
export type RepositoryRefsFailed = typeof RepositoryRefsFailed.Type;
