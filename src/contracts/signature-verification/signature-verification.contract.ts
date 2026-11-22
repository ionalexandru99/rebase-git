import { z } from "zod";
import { repositoryQuery } from "#contracts/environment-connection/environment-route.contract.ts";
import {
  ObjectId,
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const VerifySignature = z.object({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
  kind: z.enum(["commit", "tag"]),
  object: ObjectId,
});
export type VerifySignature = z.infer<typeof VerifySignature>;

const Signed = {
  signer: z.string().max(512).nullable(),
  key: z.string().max(128).nullable(),
};

export const SignatureCheck = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("Unsigned") }),
  z.object({ _tag: z.literal("Verified"), ...Signed }),
  z.object({
    _tag: z.literal("UnknownKey"),
    ...Signed,
    reason: z.enum(["KeyMissing", "KeyNotTrusted", "NotAllowedSigner"]),
  }),
  z.object({ _tag: z.literal("ExpiredKey"), ...Signed }),
  z.object({ _tag: z.literal("RevokedKey"), ...Signed }),
  z.object({ _tag: z.literal("BadSignature"), ...Signed }),
  z.object({
    _tag: z.literal("CantCheck"),
    reason: z.enum([
      "ToolMissing",
      "AllowedSignersMissing",
      "TimedOut",
      "Unreadable",
    ]),
  }),
]);
export type SignatureCheck = z.infer<typeof SignatureCheck>;

export const SignatureVerificationApi = {
  verify: repositoryQuery("repositories/signatures/verify", {
    request: VerifySignature,
    success: SignatureCheck,
  }),
};
