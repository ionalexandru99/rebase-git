import {
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type ExecFileException,
  execFile,
  spawn,
} from "node:child_process";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { Deferred, Effect, Stream } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";

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
  readonly run: (
    command: GitCommand,
  ) => Effect.Effect<GitCommandOutput, GitFailed>;
  readonly stream: (
    command: GitStreamCommand,
  ) => Stream.Stream<string, GitFailed>;
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

export function runRepositoryGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  options: RepositoryGitOptions = {},
) {
  return runRepositoryGitOutput(git, directory, args, options).pipe(
    Effect.map((output) => output.stdout),
  );
}

export function runRepositoryGitOutput(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
  { exitCodes = [0], ...options }: RepositoryGitOptions = {},
) {
  return git
    .run({ ...options, directory, arguments: args })
    .pipe(
      Effect.flatMap((output) =>
        exitCodes.includes(output.exitCode)
          ? Effect.succeed(output)
          : Effect.fail(rejectedByGit(output.exitCode, output.stderr)),
      ),
    );
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

export function readGitCommonDirectory(
  git: GitCommandRunner,
  directory: string,
  options: GitCommandOptions = {},
) {
  return runRepositoryGit(
    git,
    directory,
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    options,
  ).pipe(Effect.map((output) => output.trim()));
}

export function cacheByGitEntry<A, E>(
  read: (directory: string) => Effect.Effect<A, E>,
) {
  const entries = new Map<
    string,
    { readonly identity: string; readonly value: A }
  >();
  return {
    read: (directory: string) =>
      Effect.gen(function* () {
        const identity = yield* readGitEntryIdentity(directory);
        const cached = entries.get(directory);
        if (identity !== undefined && cached?.identity === identity)
          return cached.value;
        const value = yield* read(directory);
        if (identity !== undefined) entries.set(directory, { identity, value });
        return value;
      }),
    forget: (directory: string) => {
      entries.delete(directory);
    },
  };
}

function readGitEntryIdentity(directory: string) {
  return Effect.promise(() =>
    lstat(join(directory, ".git"), { bigint: true }).then(
      (info) =>
        info.isDirectory()
          ? `${info.dev}:${info.ino}:${info.birthtimeNs}`
          : `${info.dev}:${info.ino}:${info.ctimeNs}`,
      () => undefined,
    ),
  );
}

export function isIdentityMissing(detail: string) {
  return /Please tell me who you are|unable to auto-detect email address|empty ident name/.test(
    detail,
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
  return Effect.callback<GitCommandOutput, GitFailed>((resume) => {
    let stopped = false;
    const child = execFile(
      "git",
      gitArguments(command),
      {
        encoding: "buffer",
        env: gitEnvironment(command),
        maxBuffer: command.maxOutputBytes ?? defaultMaximumOutputBytes,
        timeout: command.timeoutMilliseconds ?? defaultTimeoutMilliseconds,
        windowsHide: true,
      },
      (error, output, errorOutput) => {
        const stdout = output.toString(command.outputEncoding ?? "utf8");
        const stderr =
          command.progress === undefined || command.progressStream === "stdout"
            ? errorOutput.toString("utf8")
            : withoutProgress(errorOutput.toString("utf8"));
        if (error === null) {
          resume(Effect.succeed({ exitCode: 0, stderr, stdout }));
          return;
        }
        const exitCode = exitCodeOf(error);
        resume(
          stopped
            ? Effect.fail(gitFailed("Failed", "Stopped from Diagnostics."))
            : exitCode === undefined
              ? Effect.fail(gitFailed(failureReason(error)))
              : Effect.succeed({ exitCode, stderr, stdout }),
        );
      },
    );
    const { progress } = command;
    if (progress !== undefined) {
      const decoder = new StringDecoder("utf8");
      const output =
        command.progressStream === "stdout" ? child.stdout : child.stderr;
      output?.on("data", (chunk: Buffer) => {
        const text = decoder.write(chunk);
        if (text !== "") progress(text);
      });
    }
    if (child.pid !== undefined)
      command.onSpawn?.(child.pid, () => {
        stopped = true;
        killGit(child);
      });
    child.stdin?.once("error", () => undefined);
    child.stdin?.end(command.input);
    return stopGit(child);
  });
}

function stopGit(child: ChildProcess) {
  return Effect.callback<void>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.void);
      return;
    }
    child.once("exit", () => resume(Effect.void));
    killGit(child);
  });
}

function killGit(child: ChildProcess) {
  if (process.platform === "win32" && child.pid !== undefined)
    execFile(
      "taskkill",
      ["/pid", String(child.pid), "/T", "/F"],
      { windowsHide: true },
      () => undefined,
    );
  else child.kill();
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

function streamLocalGitCommand(command: GitStreamCommand) {
  return Stream.unwrap(
    Effect.map(spawnGitProcess(command), (git) =>
      Stream.fromReadableStream({
        evaluate: () =>
          Readable.toWeb(
            git.child.stdout,
          ) as unknown as ReadableStream<Uint8Array>,
        onError: () => gitFailed("Failed"),
      }).pipe(
        Stream.decodeText,
        Stream.concat(Stream.fromEffectDrain(Deferred.await(git.exit))),
      ),
    ),
  ).pipe(
    Stream.interruptWhen(
      Effect.sleep(
        command.timeoutMilliseconds ?? defaultTimeoutMilliseconds,
      ).pipe(Effect.andThen(Effect.fail(gitFailed("Timeout")))),
    ),
  );
}

function spawnGitProcess(command: GitStreamCommand) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const child = spawn("git", gitArguments(command), {
        env: gitEnvironment(command),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const exit = watchGitExit(child);
      if (child.pid !== undefined)
        command.onSpawn?.(child.pid, () => killGit(child));
      child.stdin.once("error", () => undefined);
      child.stdin.end(command.input);
      return { child, exit };
    }),
    ({ child }) =>
      Effect.sync(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill();
      }),
  );
}

function watchGitExit(child: ChildProcessWithoutNullStreams) {
  const exit = Deferred.makeUnsafe<void, GitFailed>();
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    if (stderr.length < defaultMaximumOutputBytes) {
      stderr += chunk.slice(0, defaultMaximumOutputBytes - stderr.length);
    }
  });
  child.once("error", (cause: NodeJS.ErrnoException) => {
    Deferred.doneUnsafe(
      exit,
      Effect.fail(
        gitFailed(cause.code === "ENOENT" ? "GitUnavailable" : "Failed"),
      ),
    );
  });
  child.once("close", (code) => {
    Deferred.doneUnsafe(
      exit,
      code === 0
        ? Effect.void
        : Effect.fail(
            code === null ? gitFailed("Failed") : rejectedByGit(code, stderr),
          ),
    );
  });
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
  const { GIT_SEQUENCE_EDITOR: _, ...inherited } = process.env;
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

function exitCodeOf(error: ExecFileException) {
  return typeof error.code === "number" && error.killed !== true
    ? error.code
    : undefined;
}

function failureReason(error: ExecFileException): GitFailed["reason"] {
  if (error.code === "ENOENT") return "GitUnavailable";
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return "OutputTooLarge";
  if (error.killed === true || error.code === "ETIMEDOUT") return "Timeout";
  return "Failed";
}
