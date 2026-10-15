import { Effect } from "effect";
import {
  type SignatureCheck,
  SignatureVerificationApi,
  type VerifySignature,
} from "#contracts/signature-verification/signature-verification.contract.ts";
import {
  type EnvironmentFeature,
  type RepositoryDependencies,
  repositoryRoutes,
} from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  runRepositoryGit,
  runRepositoryGitOutput,
} from "#server/adapters/local-git/git-commands.ts";

type SignedCheck = Exclude<SignatureCheck, { _tag: "Unsigned" }>;
type Signed = { readonly signer: string | null; readonly key: string | null };

const signatureHeader = /^gpgsig(?:-sha256)? /m;
const signatureBlock =
  /^-----BEGIN (?:PGP SIGNATURE|PGP MESSAGE|SIGNED MESSAGE|SSH SIGNATURE)-----$/m;
const gpgStatusLine = /^\[GNUPG:\] (\S+) ?(.*)$/;
const sshSigner = /^Good "git" signature for (.+) with \S+ key (\S+)$/m;
const sshKey = /^Good "git" signature with \S+ key (\S+)$/m;
const trusted = ["TRUST_MARGINAL", "TRUST_FULLY", "TRUST_ULTIMATE"];
const severity: readonly SignedCheck["_tag"][] = [
  "BadSignature",
  "RevokedKey",
  "CantCheck",
  "ExpiredKey",
  "UnknownKey",
  "Verified",
];

export function signatureVerificationFeature(
  dependencies: RepositoryDependencies,
): EnvironmentFeature {
  const { query } = repositoryRoutes(dependencies);
  return {
    routes: [
      query(SignatureVerificationApi.verify, (input, git) =>
        verifySignature(git, input),
      ),
    ],
  };
}

function verifySignature(
  git: GitCommandRunner,
  { worktreePath, kind, object }: VerifySignature,
) {
  return runRepositoryGit(git, worktreePath, ["cat-file", kind, object]).pipe(
    Effect.flatMap((content) =>
      isSigned(kind, content)
        ? runRepositoryGitOutput(
            git,
            worktreePath,
            [`verify-${kind}`, "--raw", object],
            { exitCodes: [0, 1] },
          ).pipe(
            Effect.map((output) =>
              readSignatureOutput(
                `${output.stdout}\n${output.stderr}`,
                output.exitCode,
              ),
            ),
          )
        : Effect.succeed<SignatureCheck>({ _tag: "Unsigned" }),
    ),
    Effect.catchIf(
      (failure) => failure._tag === "GitFailed" && failure.reason === "Timeout",
      () => Effect.succeed(cantCheck("TimedOut")),
    ),
  );
}

function isSigned(kind: VerifySignature["kind"], content: string) {
  const headerEnd = content.indexOf("\n\n");
  const header = headerEnd < 0 ? content : content.slice(0, headerEnd);
  return (
    signatureHeader.test(header) ||
    (kind === "tag" && signatureBlock.test(content))
  );
}

export function readSignatureOutput(
  output: string,
  exitCode: number,
): SignedCheck {
  const check = readSignature(output.trim());
  return check._tag === "Verified" && exitCode !== 0
    ? { ...check, _tag: "UnknownKey", reason: "KeyNotTrusted" }
    : check;
}

function readSignature(text: string): SignedCheck {
  if (/cannot (?:exec|run|spawn) /.test(text)) return cantCheck("ToolMissing");
  if (
    /allowedSignersFile needs to be configured|Unable to open allowed keys file/.test(
      text,
    )
  )
    return cantCheck("AllowedSignersMissing");
  if (text.includes("[GNUPG:] "))
    return worst(
      text
        .split(/^(?=\[GNUPG:\] NEWSIG\b)/m)
        .filter((block) => block.includes("[GNUPG:] "))
        .map(readGpgSignature),
    );
  return readSshOutput(text);
}

function readGpgSignature(block: string): SignedCheck {
  const status = new Map<string, string>();
  for (const line of block.split("\n")) {
    const match = gpgStatusLine.exec(line.trim());
    if (match?.[1] !== undefined) status.set(match[1], match[2] ?? "");
  }
  const fingerprint = status.get("VALIDSIG")?.split(" ")[0] ?? null;
  const signed = (keyword: string): Signed => {
    const value = status.get(keyword) ?? "";
    const separator = value.indexOf(" ");
    return {
      signer:
        separator < 0
          ? null
          : signerName(decodeStatus(value.slice(separator + 1))),
      key: boundedKey(fingerprint ?? value.split(" ")[0]),
    };
  };
  if (status.has("BADSIG"))
    return { _tag: "BadSignature", ...signed("BADSIG") };
  if (status.has("REVKEYSIG"))
    return { _tag: "RevokedKey", ...signed("REVKEYSIG") };
  if (status.has("EXPKEYSIG"))
    return { _tag: "ExpiredKey", ...signed("EXPKEYSIG") };
  if (status.has("EXPSIG")) return { _tag: "ExpiredKey", ...signed("EXPSIG") };
  if (status.has("GOODSIG"))
    return trusted.some((level) => status.has(level))
      ? { _tag: "Verified", ...signed("GOODSIG") }
      : { _tag: "UnknownKey", reason: "KeyNotTrusted", ...signed("GOODSIG") };
  if (status.has("NO_PUBKEY"))
    return {
      _tag: "UnknownKey",
      reason: "KeyMissing",
      signer: null,
      key: boundedKey(status.get("NO_PUBKEY")),
    };
  return cantCheck("Unreadable");
}

function readSshOutput(text: string): SignedCheck {
  const verified = sshSigner.exec(text);
  if (verified?.[1] !== undefined)
    return {
      _tag: "Verified",
      signer: verified[1].slice(0, 512),
      key: boundedKey(verified[2]),
    };
  const key = boundedKey(sshKey.exec(text)?.[1]);
  if (key !== null)
    return /: key has expired: /.test(text)
      ? { _tag: "ExpiredKey", signer: null, key }
      : { _tag: "UnknownKey", reason: "NotAllowedSigner", signer: null, key };
  if (/^Signature verification failed/m.test(text))
    return { _tag: "BadSignature", signer: null, key: null };
  return cantCheck("Unreadable");
}

function worst(checks: readonly SignedCheck[]): SignedCheck {
  return (
    checks.reduce<SignedCheck | undefined>(
      (current, check) =>
        current === undefined ||
        severity.indexOf(check._tag) < severity.indexOf(current._tag)
          ? check
          : current,
      undefined,
    ) ?? cantCheck("Unreadable")
  );
}

function signerName(identity: string) {
  const name = identity.replace(/\s*<[^>]*>$/, "").trim();
  return (name === "" ? identity : name).slice(0, 512);
}

function boundedKey(key: string | undefined) {
  return key === undefined || key === "" || key.length > 128 ? null : key;
}

function decodeStatus(value: string) {
  return value.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function cantCheck(
  reason: Extract<SignatureCheck, { _tag: "CantCheck" }>["reason"],
): SignedCheck {
  return { _tag: "CantCheck", reason };
}
