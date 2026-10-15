import { Schema } from "effect";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const VerifySignature = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  kind: Schema.Literals(["commit", "tag"]),
  object: ObjectId,
});
export type VerifySignature = typeof VerifySignature.Type;

const Signed = {
  signer: Schema.NullOr(Schema.String.check(Schema.isMaxLength(512))),
  key: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
};

export const SignatureCheck = Schema.Union([
  Schema.TaggedStruct("Unsigned", {}),
  Schema.TaggedStruct("Verified", Signed),
  Schema.TaggedStruct("UnknownKey", {
    ...Signed,
    reason: Schema.Literals([
      "KeyMissing",
      "KeyNotTrusted",
      "NotAllowedSigner",
    ]),
  }),
  Schema.TaggedStruct("ExpiredKey", Signed),
  Schema.TaggedStruct("RevokedKey", Signed),
  Schema.TaggedStruct("BadSignature", Signed),
  Schema.TaggedStruct("CantCheck", {
    reason: Schema.Literals([
      "ToolMissing",
      "AllowedSignersMissing",
      "TimedOut",
      "Unreadable",
    ]),
  }),
]);
export type SignatureCheck = typeof SignatureCheck.Type;

export const SignatureVerificationApi = {
  verify: repositoryQuery("repositories/signatures/verify", {
    request: VerifySignature,
    success: SignatureCheck,
  }),
};
