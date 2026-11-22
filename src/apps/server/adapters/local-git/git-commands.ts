import {
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import {
  type RepositoryRejected,
  repositoryRejected,
} from "#contracts/git/git-failures.contract.ts";
import { signingKeyName } from "#contracts/git-signing/git-signing.contract.ts";

export interface GitCommand {
  readonly arguments: readonly string[];
  readonly directory: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly globalArguments?: readonly string[];
  readonly input?: string;
  readonly indexFile?: string;
  readonly literalPathspecs?: boolean;
  readonly objectDirectory?: string;
  readonly outputEncoding?: "utf8" | "base64";
  readonly maxOutputBytes?: number;
  readonly timeoutMilliseconds?: number;
  readonly progress?: (output: string) => void;
  readonly progressStream?: "stdout" | "stderr";
  readonly onSpawn?: (pid: number, stop: () => void) => void;
  readonly expectedExitCodes?: readonly number[];
  readonly signal?: AbortSignal;
}

export type GitCommandOptions = Omit<GitCommand, "arguments" | "directory">;

type GitStreamCommand = Omit<
  GitCommand,
  "outputEncoding" | "maxOutputBytes" | "progress" | "progressStream"
>;

type GitStreamOptions = Omit<GitStreamCommand, "arguments" | "directory">;

export interface GitCommandOutput {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface GitFailed {
  readonly _tag: "GitFailed";
  readonly reason: "GitUnavailable" | "Timeout" | "OutputTooLarge" | "Failed";
  readonly detail: string;
  readonly exitCode?: number;
}

export type GitObjectFormat = "sha1" | "sha256";

export interface GitCommandRunner {
  readonly run: (command: GitCommand) => Promise<GitCommandOutput>;
  readonly stream: (command: GitStreamCommand) => AsyncIterable<string>;
}

interface RepositoryGitOptions extends GitCommandOptions {
  readonly exitCodes?: readonly number[];
}

const objectIdLengths: Readonly<Record<GitObjectFormat, number>> = {
  sha1: 40,
  sha256: 64,
};
const hexadecimal = /^[0-9a-f]+$/;
const defaultTimeoutMilliseconds = 30_000;
const detached = process.platform !== "win32";
const defaultMaximumOutputBytes = 16 * 1_048_576;
const maximumDetailLength = 2_048;
const progressLines = [
  /^[A-Z][a-z]+(?: (?:[a-z]+|LFS))*: +\d+% \(\d+\/\d+\)(?:, [\d.]+ (?:[KMG]i?B|B|bytes?)(?: \| [\d.]+ (?:[KMG]i?B|B|bytes?)\/s)?)?(?:, done\.)?$/,
  /^(?:Enumerating|Counting) objects: \d+(?:, done\.)?$/,
  /^Delta compression using up to \d+ threads?$/,
  /^Total \d+ \(delta \d+\), reused \d+ \(delta \d+\)/,
  /^Rebasing \(\d+\/\d+\)$/,
];

export function createLocalGitCommandRunner(): GitCommandRunner {
  return {
    run: runLocalGitCommand,
    stream: streamLocalGitCommand,
  };
}

export async function runRepositoryGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  options: RepositoryGitOptions = {},
) {
  return (await runRepositoryGitOutput(git, directory, args, options)).stdout;
}

export async function runRepositoryGitOutput(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  { exitCodes = [0], ...options }: RepositoryGitOptions = {},
) {
  const output = await git.run({
    ...options,
    directory,
    arguments: args,
    expectedExitCodes: exitCodes,
  });
  if (!exitCodes.includes(output.exitCode))
    throw rejectedByGit(output.exitCode, output.stderr);
  return output;
}

export function streamRepositoryGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  options: GitStreamOptions = {},
) {
  return git.stream({ ...options, directory, arguments: args });
}

export function isGitObjectId(value: string, objectFormat?: GitObjectFormat) {
  const lengths =
    objectFormat === undefined
      ? Object.values(objectIdLengths)
      : [objectIdLengths[objectFormat]];
  return lengths.includes(value.length) && hexadecimal.test(value);
}

export async function readGitCommonDirectory(
  git: GitCommandRunner,
  directory: string,
  options: GitCommandOptions = {},
) {
  return (
    await runRepositoryGit(
      git,
      directory,
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      options,
    )
  ).trim();
}

export function cacheByGitEntry<Value>(
  read: (directory: string) => Promise<Value>,
) {
  const entries = new Map<
    string,
    { readonly identity: string; readonly value: Value }
  >();
  return {
    read: async (directory: string) => {
      const identity = await readGitEntryIdentity(directory);
      const cached = entries.get(directory);
      if (identity !== undefined && cached?.identity === identity)
        return cached.value;
      const value = await read(directory);
      if (identity !== undefined) entries.set(directory, { identity, value });
      return value;
    },
    forget: (directory: string) => {
      entries.delete(directory);
    },
  };
}

function readGitEntryIdentity(directory: string) {
  return lstat(join(directory, ".git"), { bigint: true }).then(
    (info) =>
      info.isDirectory()
        ? `${info.dev}:${info.ino}:${info.birthtimeNs}`
        : `${info.dev}:${info.ino}:${info.ctimeNs}`,
    () => undefined,
  );
}

export function isIdentityMissing(detail: string) {
  return /Please tell me who you are|unable to auto-detect email address|empty ident name/.test(
    detail,
  );
}

export function signingRejection(
  detail: string,
): RepositoryRejected | undefined {
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

export function isLfsMissing(detail: string) {
  return /'git-lfs' was not found on your path|git-lfs: (?:command )?not found|'lfs' is not a git command/.test(
    detail,
  );
}

export function lfsMissing() {
  return repositoryRejected(
    "LfsMissing",
    "Git LFS isn't installed on this server.",
  );
}

export function isGitRejection(failure: GitFailed) {
  return failure.exitCode !== undefined;
}

export function isGitFailed(error: unknown): error is GitFailed {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "GitFailed"
  );
}

export function gitFailed(
  reason: GitFailed["reason"],
  detail = `Git could not complete the operation (${reason}).`,
): GitFailed {
  return {
    _tag: "GitFailed",
    reason,
    detail: detail.slice(0, maximumDetailLength),
  };
}

function rejectedByGit(exitCode: number, stderr: string): GitFailed {
  return {
    ...gitFailed("Failed", stderr.trim() || "Git rejected the operation."),
    exitCode,
  };
}

function runLocalGitCommand(command: GitCommand) {
  return new Promise<GitCommandOutput>((resolve, reject) => {
    let ended: GitFailed["reason"] | "Stopped" | undefined;
    let finished = false;
    const finish = (settle: () => void) => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      command.signal?.removeEventListener("abort", abort);
      settle();
    };
    const fail = (failure: GitFailed) => finish(() => reject(failure));
    const end = (reason: GitFailed["reason"] | "Stopped") => {
      if (ended !== undefined || !running(child)) return;
      ended = reason;
      killGit(child);
    };
    const abort = () => end("Failed");
    if (command.signal?.aborted) {
      reject(command.signal.reason);
      return;
    }
    const child = startGit(command);
    command.signal?.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(
      () => end("Timeout"),
      command.timeoutMilliseconds ?? defaultTimeoutMilliseconds,
    );
    const limit = command.maxOutputBytes ?? defaultMaximumOutputBytes;
    const output = collectOutput(child.stdout, limit, () =>
      end("OutputTooLarge"),
    );
    const errorOutput = collectOutput(child.stderr, limit, () =>
      end("OutputTooLarge"),
    );
    const { progress } = command;
    if (progress !== undefined) {
      const decoder = new StringDecoder("utf8");
      const stream =
        command.progressStream === "stdout" ? child.stdout : child.stderr;
      stream.on("data", (chunk: Buffer) => {
        const text = decoder.write(chunk);
        if (text !== "") progress(text);
      });
    }
    child.once("error", (cause: NodeJS.ErrnoException) =>
      fail(gitFailed(cause.code === "ENOENT" ? "GitUnavailable" : "Failed")),
    );
    child.once("close", (code) => {
      if (command.signal?.aborted)
        return finish(() => reject(command.signal?.reason));
      if (ended === "Stopped")
        return fail(gitFailed("Failed", "Stopped from Diagnostics."));
      if (ended !== undefined) return fail(gitFailed(ended));
      if (code === null) return fail(gitFailed("Failed"));
      const stdout = Buffer.concat(output).toString(
        command.outputEncoding ?? "utf8",
      );
      const stderr = Buffer.concat(errorOutput).toString("utf8");
      finish(() =>
        resolve({
          exitCode: code,
          stdout,
          stderr:
            progress === undefined || command.progressStream === "stdout"
              ? stderr
              : withoutProgress(stderr),
        }),
      );
    });
    if (child.pid !== undefined)
      command.onSpawn?.(child.pid, () => end("Stopped"));
  });
}

function collectOutput(
  stream: Readable,
  limit: number,
  overflow: () => void,
): readonly Buffer[] {
  const chunks: Buffer[] = [];
  let bytes = 0;
  stream.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > limit) overflow();
    else chunks.push(chunk);
  });
  return chunks;
}

function startGit(command: GitStreamCommand) {
  const child = spawn("git", gitArguments(command), {
    detached,
    env: gitEnvironment(command),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdin.once("error", () => undefined);
  child.stdin.end(command.input);
  return child;
}

function running(child: ChildProcess) {
  return child.stdout?.closed !== true || child.stderr?.closed !== true;
}

function killGit(child: ChildProcess) {
  if (process.platform === "win32" && child.pid !== undefined) {
    closeOutputOnExit(child);
    execFile(
      "taskkill",
      ["/pid", String(child.pid), "/T", "/F"],
      { windowsHide: true },
      () => undefined,
    );
  } else signalGit(child);
}

function closeOutputOnExit(child: ChildProcess) {
  const close = () => {
    child.stdout?.destroy();
    child.stderr?.destroy();
  };
  if (child.exitCode !== null || child.signalCode !== null) close();
  else child.once("exit", close);
}

function signalGit(child: ChildProcess) {
  if (detached && child.pid !== undefined)
    try {
      process.kill(-child.pid);
      return;
    } catch {}
  child.kill();
}

function withoutProgress(stderr: string) {
  return stderr
    .split("\n")
    .flatMap((line) => {
      const kept = line
        .split("\r")
        .filter((segment) => segment !== "" && !isProgressLine(segment));
      return kept.length === 0 && line !== "" ? [] : [kept.join("\n")];
    })
    .join("\n");
}

function isProgressLine(segment: string) {
  const line = segment.replace(/^remote: /, "").trimEnd();
  return progressLines.some((pattern) => pattern.test(line));
}

async function* streamLocalGitCommand(command: GitStreamCommand) {
  command.signal?.throwIfAborted();
  const child = startGit(command);
  const exit = watchGitExit(child);
  const stop = () => {
    if (running(child)) killGit(child);
  };
  if (child.pid !== undefined) command.onSpawn?.(child.pid, stop);
  let timedOut = false;
  const deadline = setTimeout(() => {
    timedOut = true;
    stop();
  }, command.timeoutMilliseconds ?? defaultTimeoutMilliseconds);
  command.signal?.addEventListener("abort", stop, { once: true });
  try {
    const decoder = new StringDecoder("utf8");
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      const text = decoder.write(chunk);
      if (text !== "") yield text;
    }
    const rest = decoder.end();
    if (rest !== "") yield rest;
    await exit;
    if (timedOut) throw gitFailed("Timeout");
  } catch (error) {
    if (timedOut) throw gitFailed("Timeout");
    if (isGitFailed(error) || command.signal?.aborted) throw error;
    throw gitFailed("Failed");
  } finally {
    clearTimeout(deadline);
    command.signal?.removeEventListener("abort", stop);
    if (running(child)) signalGit(child);
  }
}

function watchGitExit(child: ChildProcessWithoutNullStreams) {
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < defaultMaximumOutputBytes) {
      stderr += chunk.slice(0, defaultMaximumOutputBytes - stderr.length);
    }
  });
  const exit = new Promise<void>((resolve, reject) => {
    child.once("error", (cause: NodeJS.ErrnoException) =>
      reject(gitFailed(cause.code === "ENOENT" ? "GitUnavailable" : "Failed")),
    );
    child.once("close", (code) => {
      if (code === 0) resolve();
      else
        reject(
          code === null ? gitFailed("Failed") : rejectedByGit(code, stderr),
        );
    });
  });
  exit.catch(() => undefined);
  return exit;
}

function gitArguments(command: GitCommand) {
  return [
    "-C",
    command.directory,
    ...(command.literalPathspecs === false ? [] : ["--literal-pathspecs"]),
    ...(command.globalArguments ?? []),
    ...command.arguments,
  ];
}

function gitEnvironment(command: GitCommand) {
  const {
    GIT_SEQUENCE_EDITOR: _editor,
    GPG_TTY: _terminal,
    ...inherited
  } = process.env;
  return {
    ...inherited,
    ...command.environment,
    GIT_EDITOR: "true",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
    ...(command.indexFile === undefined
      ? {}
      : { GIT_INDEX_FILE: command.indexFile }),
    ...(command.objectDirectory === undefined
      ? {}
      : { GIT_OBJECT_DIRECTORY: command.objectDirectory }),
  };
}
