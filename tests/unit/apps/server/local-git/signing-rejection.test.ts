import { describe, expect, it } from "vite-plus/test";
import { signingRejection } from "#server/adapters/local-git/git-commands.ts";

const commitFailed = "\n\nfatal: failed to write commit object";

describe("signing rejection", () => {
  it.each([
    [
      "fatal: either user.signingkey or gpg.ssh.defaultKeyCommand needs to be configured",
      "SigningUnavailable",
      "Choose a signing key.",
    ],
    [
      `error: cannot run /opt/gnupg/bin/gpg: No such file or directory\nerror: gpg failed to sign the data:\n(no gpg output)${commitFailed}`,
      "SigningUnavailable",
      "Install gpg, then try again.",
    ],
    [
      `error: cannot spawn C:/Program Files/OpenSSH/ssh-keygen.exe: No such file or directory\nerror: ${commitFailed}`,
      "SigningUnavailable",
      "Install ssh-keygen.exe, then try again.",
    ],
    [
      `error: Couldn't load public key /home/ada/.ssh/work.pub: No such file or directory?${commitFailed}`,
      "SigningUnavailable",
      "Can't find the signing key work.",
    ],
    [
      `error: No private key found for public key "/home/ada/.ssh/id_ed25519.pub"?${commitFailed}`,
      "SigningUnavailable",
      "Can't find the signing key id_ed25519.",
    ],
    [
      `error: gpg failed to sign the data:\ngpg: skipped "DEADBEEF": No secret key\ngpg: signing failed: No secret key${commitFailed}`,
      "SigningUnavailable",
      "Can't find your GPG signing key.",
    ],
    [
      `error: Load key "/home/ada/.ssh/id_ed25519": incorrect passphrase supplied to decrypt private key?${commitFailed}`,
      "SigningLocked",
      "Add id_ed25519 to your SSH agent, then try again.",
    ],
    [
      `error: Couldn't get agent socket?${commitFailed}`,
      "SigningLocked",
      "Start your SSH agent, then try again.",
    ],
    [
      `error: gpg failed to sign the data:\ngpg: signing failed: Inappropriate ioctl for device${commitFailed}`,
      "SigningLocked",
      "Unlock your GPG key, then try again.",
    ],
  ])("turns %j into a %s rejection", (detail, reason, message) => {
    expect(signingRejection(detail)).toEqual({
      _tag: "RepositoryRejected",
      reason,
      detail: message,
    });
  });

  it("leaves failures that are not about signing to the caller", () => {
    expect(
      signingRejection(
        "error: cannot run .git/hooks/pre-commit: No such file or directory",
      ),
    ).toBeUndefined();
  });
});
