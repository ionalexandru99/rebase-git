import { describe, expect, it } from "vite-plus/test";
import { readSignatureOutput } from "#server/features/signature-verification/signature-verification.ts";

const read = (output: string, exitCode = 0) =>
  readSignatureOutput(output, exitCode);
const fingerprint = "3330681B9E54643A4B70BE79A9515787193D95A5";
const sshKey = "SHA256:aFbW+AMOCtKlhfHTnE0UV4Ra0aQIWfa6u3japROpK2c";

function gpg(signature: string, ...extra: readonly string[]) {
  return [
    "[GNUPG:] NEWSIG ana@example.test",
    `[GNUPG:] KEY_CONSIDERED ${fingerprint} 0`,
    `[GNUPG:] ${signature} A9515787193D95A5 Ana Pop <ana@example.test>`,
    `[GNUPG:] VALIDSIG ${fingerprint} 2026-10-15 1792097411 0 4 0 22 10 00 ${fingerprint}`,
    ...extra,
  ].join("\n");
}

const ana = { signer: "Ana Pop", key: fingerprint };

describe("signature output", () => {
  it("reads every GPG result, keeping a valid seal apart from a trusted key", () => {
    expect(read(gpg("GOODSIG", "[GNUPG:] TRUST_ULTIMATE 0 pgp"))).toEqual({
      _tag: "Verified",
      ...ana,
    });
    expect(read(gpg("GOODSIG", "[GNUPG:] TRUST_UNDEFINED 0 pgp"))).toEqual({
      _tag: "UnknownKey",
      reason: "KeyNotTrusted",
      ...ana,
    });
    expect(read(gpg("EXPKEYSIG"))).toEqual({
      _tag: "ExpiredKey",
      ...ana,
    });
    expect(read(gpg("EXPSIG"))).toEqual({
      _tag: "ExpiredKey",
      ...ana,
    });
    expect(
      read(
        gpg(
          "REVKEYSIG",
          "[GNUPG:] KEYREVOKED",
          "[GNUPG:] TRUST_ULTIMATE 0 pgp",
        ),
      ),
    ).toEqual({ _tag: "RevokedKey", ...ana });
    expect(
      read(
        "[GNUPG:] NEWSIG\n[GNUPG:] BADSIG A9515787193D95A5 Ana Pop <ana@example.test>\n[GNUPG:] FAILURE gpg-exit 33554433",
      ),
    ).toEqual({
      _tag: "BadSignature",
      signer: "Ana Pop",
      key: "A9515787193D95A5",
    });
    expect(
      read(
        "[GNUPG:] NEWSIG ion@example.test\n[GNUPG:] ERRSIG F49628B60DAE8039 22 10 00 1792097411 9 -\n[GNUPG:] NO_PUBKEY F49628B60DAE8039\n[GNUPG:] FAILURE gpg-exit 33554433",
      ),
    ).toEqual({
      _tag: "UnknownKey",
      reason: "KeyMissing",
      signer: null,
      key: "F49628B60DAE8039",
    });
  });

  it("decodes signer names GPG escapes and keeps non-ASCII ones", () => {
    const output = gpg("GOODSIG", "[GNUPG:] TRUST_FULLY 0 pgp").replace(
      "Ana Pop <ana@example.test>",
      "Ion Ţepeş 100%25 <ion@example.test>",
    );

    expect(read(output)).toMatchObject({
      signer: "Ion Ţepeş 100%",
    });
  });

  it("reads every SSH result", () => {
    expect(
      read(
        `Good "git" signature for ana@example.test with ED25519 key ${sshKey}`,
      ),
    ).toEqual({
      _tag: "Verified",
      signer: "ana@example.test",
      key: sshKey,
    });
    expect(
      read(
        `Good "git" signature with ED25519 key ${sshKey}\nNo principal matched.`,
      ),
    ).toEqual({
      _tag: "UnknownKey",
      reason: "NotAllowedSigner",
      signer: null,
      key: sshKey,
    });
    expect(
      read(
        `Good "git" signature with ED25519 key ${sshKey}\n/home/ana/allowed:1: key has expired: verify time 2026-10-16T00:49:55 > valid-before 2020-01-01T00:00:00\nNo principal matched.`,
      ),
    ).toEqual({ _tag: "ExpiredKey", signer: null, key: sshKey });
    expect(
      read(
        "Could not verify signature.\nSignature verification failed: incorrect signature",
      ),
    ).toEqual({
      _tag: "BadSignature",
      signer: null,
      key: null,
    });
  });

  it("reports a broken setup as can't check where Git's own answer says unsigned or bad", () => {
    expect(read("error: cannot run gpg: No such file or directory")).toEqual({
      _tag: "CantCheck",
      reason: "ToolMissing",
    });
    expect(
      read("fatal: cannot exec '/opt/ssh-keygen': No such file or directory"),
    ).toEqual({ _tag: "CantCheck", reason: "ToolMissing" });
    expect(read("error: cannot spawn gpg: No such file or directory")).toEqual({
      _tag: "CantCheck",
      reason: "ToolMissing",
    });
    expect(
      read(
        "error: gpg.ssh.allowedSignersFile needs to be configured and exist for ssh signature verification",
      ),
    ).toEqual({ _tag: "CantCheck", reason: "AllowedSignersMissing" });
    expect(read("Could not verify signature.")).toEqual({
      _tag: "CantCheck",
      reason: "Unreadable",
    });
  });

  it("never calls a signature verified when Git rejects it", () => {
    expect(read(gpg("GOODSIG", "[GNUPG:] TRUST_FULLY 0 pgp"), 1)).toEqual({
      _tag: "UnknownKey",
      reason: "KeyNotTrusted",
      ...ana,
    });
  });

  it("reports the worst signature when an object carries several", () => {
    const trustedThenUntrusted = [
      gpg("GOODSIG", "[GNUPG:] TRUST_ULTIMATE 0 pgp"),
      gpg("GOODSIG", "[GNUPG:] TRUST_UNDEFINED 0 pgp"),
    ].join("\n");

    expect(read(trustedThenUntrusted)).toMatchObject({
      _tag: "UnknownKey",
      reason: "KeyNotTrusted",
    });
  });

  it("never reads silent or unexpected output as a good signature", () => {
    expect(read("\n")).toEqual({
      _tag: "CantCheck",
      reason: "Unreadable",
    });
    expect(
      read(
        `Good "git" signature with ED25519 key ${sshKey}\nUnable to open allowed keys file "/home/ana/missing": No such file or directory`,
      ),
    ).toEqual({ _tag: "CantCheck", reason: "AllowedSignersMissing" });
    expect(
      read(
        `[GNUPG:] NEWSIG\n[GNUPG:] ERRSIG - 1 8 00 1792097411 9 -\n[GNUPG:] NO_PUBKEY ${"A".repeat(200)}`,
      ),
    ).toMatchObject({ _tag: "UnknownKey", reason: "KeyMissing", key: null });
  });
});
