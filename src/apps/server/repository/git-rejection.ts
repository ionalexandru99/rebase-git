import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import { signingKeyName } from "#contracts/git-signing/git-signing.contract.ts";

export function rejectionFromGit(detail: string): RepositoryRejected {
  if (
    /Please tell me who you are|unable to auto-detect email address|empty ident name/.test(
      detail,
    )
  )
    return repositoryRejected(
      "IdentityMissing",
      "Add your name and email to commit.",
    );
  if (
    /'git-lfs' was not found on your path|git-lfs: (?:command )?not found|'lfs' is not a git command/.test(
      detail,
    )
  )
    return repositoryRejected(
      "LfsMissing",
      "Git LFS isn't installed on this server.",
    );
  return signingRejection(detail) ?? repositoryRejected("GitFailed", detail);
}

function signingRejection(detail: string): RepositoryRejected | undefined {
  const unavailable = (text: string) =>
    repositoryRejected("SigningUnavailable", text);
  const locked = (text: string) => repositoryRejected("SigningLocked", text);
  if (/either user\.signingkey or gpg\.ssh\.defaultKeyCommand/.test(detail))
    return unavailable("Choose a signing key.");
  const program =
    /cannot (?:run|spawn) ([^\n]+?): No such file or directory/.exec(
      detail,
    )?.[1];
  if (
    program !== undefined &&
    /failed to write commit object|unable to sign the tag/.test(detail)
  )
    return unavailable(
      `Install ${program.split(/[\\/]/).at(-1)}, then try again.`,
    );
  const missing =
    /Couldn't load public key ([^\n]+?): No such file or directory/.exec(
      detail,
    )?.[1] ??
    /No private key found for public key "([^"\n]+)"/.exec(detail)?.[1];
  if (missing !== undefined)
    return unavailable(
      `Can't find the signing key ${signingKeyName(missing)}.`,
    );
  const ssh = /Load key "([^"\n]+)": incorrect passphrase supplied/.exec(
    detail,
  )?.[1];
  if (ssh !== undefined)
    return locked(
      `Add ${signingKeyName(ssh)} to your SSH agent, then try again.`,
    );
  if (/Couldn't get agent socket/.test(detail))
    return locked("Start your SSH agent, then try again.");
  if (!/gpg failed to sign the data/.test(detail)) return undefined;
  if (/No secret key|No public key|unusable secret key/.test(detail))
    return unavailable("Can't find your GPG signing key.");
  if (/Inappropriate ioctl for device|Operation cancelled|Timeout/.test(detail))
    return locked("Unlock your GPG key, then try again.");
  const reason = /gpg: signing failed: ([^\n]+)/.exec(detail)?.[1];
  return unavailable(
    reason === undefined
      ? "GPG couldn't sign."
      : `GPG couldn't sign: ${reason.trim().replace(/\.$/, "")}.`,
  );
}
