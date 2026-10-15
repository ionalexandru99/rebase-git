import { Schema } from "effect";
import {
  repositoryCommand,
  repositoryQuery,
  route,
} from "#contracts/environment-connection/environment-route.contract.ts";
import { RepositoryId } from "#contracts/git/git-values.contract.ts";

export const SigningFormat = Schema.Literals(["openpgp", "ssh", "x509"]);
export type SigningFormat = typeof SigningFormat.Type;

const KeyReference = {
  format: SigningFormat,
  key: Schema.Trim.check(Schema.isMaxLength(8_192)),
};

export const SigningFormats = SigningFormat.literals;

export const SigningKey = Schema.Struct({
  ...KeyReference,
  label: Schema.String,
});
export type SigningKey = typeof SigningKey.Type;

const Off = Schema.TaggedStruct("Off", {});

export const Signing = Schema.Union([
  Off,
  Schema.TaggedStruct("Key", SigningKey.fields),
]);
export type Signing = typeof Signing.Type;

export const SigningChoice = Schema.Union([
  Off,
  Schema.TaggedStruct("Key", KeyReference),
]);
export type SigningChoice = typeof SigningChoice.Type;

export const RepositorySigning = Schema.Struct({
  local: Schema.NullOr(Signing),
  inherited: Signing,
});
export type RepositorySigning = typeof RepositorySigning.Type;

export const SigningFailed = Schema.TaggedStruct("SigningFailed", {
  detail: Schema.String.check(Schema.isMaxLength(2_048)),
});
export type SigningFailed = typeof SigningFailed.Type;

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
    success: Schema.Array(SigningKey),
    failure: SigningFailed,
  }),
  readRepository: repositoryQuery("repositories/signing", {
    request: Schema.Struct({ repositoryId: RepositoryId }),
    success: RepositorySigning,
  }),
  saveRepository: repositoryCommand("repositories/save-signing", {
    request: Schema.Struct({
      repositoryId: RepositoryId,
      signing: Schema.NullOr(SigningChoice),
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
