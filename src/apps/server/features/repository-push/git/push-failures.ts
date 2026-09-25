import type { PushRejected, PushRejectedReason } from "@rebase/contracts";
import { Data } from "effect";
import type { GitCommandOutput } from "#server/domain/git-command.contract";

export class RepositoryPushError extends Data.TaggedError(
  "RepositoryPushError",
)<{
  readonly failure: PushRejected;
}> {}

export function pushError(reason: PushRejectedReason, detail: string) {
  return new RepositoryPushError({
    failure: { _tag: "PushRejected", reason, detail: detail.slice(0, 2_048) },
  });
}

export function pushRefStatus(stdout: string, destinationRef: string) {
  for (const line of stdout.split("\n")) {
    const [flag, refs, summary] = line.split("\t");
    if (
      flag !== undefined &&
      summary !== undefined &&
      refs?.endsWith(`:${destinationRef}`)
    )
      return { flag, summary };
  }
  return undefined;
}

export function classifyPushFailure(
  output: GitCommandOutput,
  destinationRef: string,
) {
  const status = pushRefStatus(output.stdout, destinationRef);
  const remoteMessages = output.stderr
    .split("\n")
    .filter((line) => line.startsWith("remote:"))
    .map((line) => line.slice("remote:".length).trim())
    .filter((line) => line.length > 0);
  if (status?.flag === "!") {
    if (status.summary.includes("(stale info)"))
      return pushError(
        "LeaseRejected",
        "The remote branch moved since the reviewed tip.",
      );
    if (/\((non-fast-forward|fetch first)\)/.test(status.summary))
      return pushError(
        "NonFastForward",
        "The remote branch has commits the local branch lacks.",
      );
    if (status.summary.includes("[remote rejected]"))
      return pushError(
        "HookDeclined",
        [status.summary, ...remoteMessages].join("\n"),
      );
    return pushError("Failed", status.summary);
  }
  const stderr = output.stderr.trim();
  if (
    /Authentication failed|could not read (Username|Password)|Permission denied|terminal prompts disabled|returned error: 40[13]/i.test(
      stderr,
    )
  )
    return pushError("Authentication", stderr);
  if (/does not appear to be a git repository|No such remote/i.test(stderr))
    return pushError("RemoteMissing", stderr);
  if (
    /Could not resolve host|Failed to connect|Connection (timed out|refused|reset)|unable to access|Network is unreachable|Could not read from remote repository/i.test(
      stderr,
    )
  )
    return pushError("Network", stderr);
  if (status === undefined && /failed to push some refs/.test(stderr))
    return pushError(
      "HookDeclined",
      stderr.replace(/^error: failed to push some refs.*$/m, "").trim() ||
        stderr,
    );
  return pushError("Failed", stderr || "Git rejected the push.");
}
