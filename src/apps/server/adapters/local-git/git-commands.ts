import { type ChildProcess, execFile, spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

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

export interface GitCommandRunner {
  readonly run: (command: GitCommand) => Promise<GitCommandOutput>;
  readonly stream: (command: GitStreamCommand) => AsyncIterable<string>;
}

interface RepositoryGitOptions extends GitCommandOptions {
  readonly exitCodes?: readonly number[];
}

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

async function runLocalGitCommand(
  command: GitCommand,
): Promise<GitCommandOutput> {
  command.signal?.throwIfAborted();
  const limit = command.maxOutputBytes ?? defaultMaximumOutputBytes;
  const git = startGit(command, limit);
  const output = collectOutput(git.child.stdout, limit, () =>
    git.stop("OutputTooLarge"),
  );
  const { progress } = command;
  if (progress !== undefined) {
    const decoder = new StringDecoder("utf8");
    const stream =
      command.progressStream === "stdout" ? git.child.stdout : git.child.stderr;
    stream.on("data", (chunk: Buffer) => {
      const text = decoder.write(chunk);
      if (text !== "") progress(text);
    });
  }
  const exitCode = await git.exit;
  const stderr = git.stderr();
  return {
    exitCode,
    stdout: Buffer.concat(output).toString(command.outputEncoding ?? "utf8"),
    stderr:
      progress === undefined || command.progressStream === "stdout"
        ? stderr
        : withoutProgress(stderr),
  };
}

async function* streamLocalGitCommand(command: GitStreamCommand) {
  command.signal?.throwIfAborted();
  const git = startGit(command);
  try {
    try {
      const decoder = new StringDecoder("utf8");
      for await (const chunk of git.child.stdout as AsyncIterable<Buffer>) {
        const text = decoder.write(chunk);
        if (text !== "") yield text;
      }
      const rest = decoder.end();
      if (rest !== "") yield rest;
    } catch {
      git.stop("Failed");
      await git.exit;
      throw gitFailed("Failed");
    }
    const exitCode = await git.exit;
    if (exitCode !== 0) throw rejectedByGit(exitCode, git.stderr());
  } finally {
    git.stop("Failed");
    await git.exit.catch(() => undefined);
  }
}

function startGit(command: GitStreamCommand, outputLimit?: number) {
  const child = spawn("git", gitArguments(command), {
    detached,
    env: gitEnvironment(command),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdin.once("error", () => undefined);
  child.stdin.end(command.input);
  let ended: GitFailed["reason"] | "Stopped" | undefined;
  const stop = (reason: GitFailed["reason"] | "Stopped") => {
    if (ended !== undefined || !running(child)) return;
    ended = reason;
    killGit(child);
  };
  const abort = () => stop("Failed");
  command.signal?.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(
    () => stop("Timeout"),
    command.timeoutMilliseconds ?? defaultTimeoutMilliseconds,
  );
  const errorOutput = collectOutput(
    child.stderr,
    outputLimit ?? defaultMaximumOutputBytes,
    () => {
      if (outputLimit !== undefined) stop("OutputTooLarge");
    },
  );
  const exit = new Promise<number>((resolve, reject) => {
    child.once("error", (cause: NodeJS.ErrnoException) =>
      reject(gitFailed(cause.code === "ENOENT" ? "GitUnavailable" : "Failed")),
    );
    child.once("close", (code) => {
      if (command.signal?.aborted) reject(command.signal.reason);
      else if (ended === "Stopped")
        reject(gitFailed("Failed", "Stopped from Diagnostics."));
      else if (ended !== undefined) reject(gitFailed(ended));
      else if (code === null) reject(gitFailed("Failed"));
      else resolve(code);
    });
  }).finally(() => {
    clearTimeout(deadline);
    command.signal?.removeEventListener("abort", abort);
  });
  exit.catch(() => undefined);
  if (child.pid !== undefined)
    command.onSpawn?.(child.pid, () => stop("Stopped"));
  return {
    child,
    exit,
    stop,
    stderr: () => Buffer.concat(errorOutput).toString("utf8"),
  };
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
