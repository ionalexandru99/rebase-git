import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
  route,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryId } from "#contracts/git/git-values.contract.ts";

export const SigningFormat = z.enum(["openpgp", "ssh", "x509"]);
export type SigningFormat = z.infer<typeof SigningFormat>;

const KeyReference = {
  format: SigningFormat,
  key: z.string().trim().max(8_192),
};

export const SigningFormats = SigningFormat.options;

export const SigningKey = z.object({
  ...KeyReference,
  label: z.string(),
});
export type SigningKey = z.infer<typeof SigningKey>;

const Off = z.object({ _tag: z.literal("Off") });

export const Signing = z.discriminatedUnion("_tag", [
  Off,
  z.object({ _tag: z.literal("Key"), ...SigningKey.shape }),
]);
export type Signing = z.infer<typeof Signing>;

export const SigningChoice = z.discriminatedUnion("_tag", [
  Off,
  z.object({ _tag: z.literal("Key"), ...KeyReference }),
]);
export type SigningChoice = z.infer<typeof SigningChoice>;

export const RepositorySigning = z.object({
  local: Signing.nullable(),
  inherited: Signing,
});
export type RepositorySigning = z.infer<typeof RepositorySigning>;

export const SigningFailed = z.object({
  _tag: z.literal("SigningFailed"),
  detail: z.string().max(2_048),
});
export type SigningFailed = z.infer<typeof SigningFailed>;

export const GitSigningApi = {
  read: route("git-signing/read", {
    success: Signing,
    failure: SigningFailed,
  }),
  save: route("git-signing/save", {
    request: SigningChoice,
    success: Signing,
    failure: SigningFailed,
  }),
  keys: route("git-signing/keys", {
    success: z.array(SigningKey).readonly(),
    failure: SigningFailed,
  }),
  readRepository: repositoryQuery("repositories/signing", {
    request: z.object({ repositoryId: RepositoryId }),
    success: RepositorySigning,
  }),
  saveRepository: repositoryCommand("repositories/save-signing", {
    request: z.object({
      repositoryId: RepositoryId,
      signing: SigningChoice.nullable(),
    }),
    success: RepositorySigning,
  }),
};

export function signingKeyName(path: string) {
  return (path.split(/[\\/]/).at(-1) ?? path).replace(/\.pub$/, "");
}

export function sshPublicKey(value: string) {
  const parts = /^(?:key::)?((?:ssh-|ecdsa-|sk-)\S+)\s+(\S+)\s*(.*)$/.exec(
    value.trim(),
  );
  return parts === null
    ? undefined
    : { type: parts[1] ?? "", blob: parts[2] ?? "", comment: parts[3] ?? "" };
}

export function sameSigningKey(
  a: Pick<SigningKey, "format" | "key">,
  b: Pick<SigningKey, "format" | "key">,
) {
  if (a.format !== b.format) return false;
  if (a.key === b.key) return true;
  if (a.key === "" || b.key === "") return false;
  if (a.format === "ssh") return sshIdentity(a.key) === sshIdentity(b.key);
  const first = gpgKeyId(a.key);
  const second = gpgKeyId(b.key);
  return (
    first !== undefined &&
    second !== undefined &&
    (first.endsWith(second) || second.endsWith(first))
  );
}

export function gpgKeyId(value: string) {
  return /^(?:0x)?([0-9a-f]{8,40})!?$/i.exec(value)?.[1]?.toUpperCase();
}

function sshIdentity(key: string) {
  return sshPublicKey(key)?.blob ?? signingKeyName(key);
}
