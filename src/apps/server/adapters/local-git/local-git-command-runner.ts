import {
  type ChildProcessWithoutNullStreams,
  type ExecFileException,
  execFile,
  spawn,
} from "node:child_process";
import { Readable } from "node:stream";
import { Deferred, Effect, Layer, Stream } from "effect";
import {
  type GitCommand,
  GitCommandError,
  type GitCommandFailureReason,
  type GitCommandOutput,
  type GitCommandRunner,
  GitCommands,
  type GitStreamCommand,
} from "#server/domain/git-command.contract";

const defaultTimeoutMilliseconds = 30_000;
const defaultMaximumOutputBytes = 16 * 1_048_576;

export function createLocalGitCommandRunner(): GitCommandRunner {
  return {
    run: runLocalGitCommand,
    stream: streamLocalGitCommand,
  };
}

export const localGitCommandRunnerLayer = Layer.sync(
  GitCommands,
  createLocalGitCommandRunner,
);

function runLocalGitCommand(command: GitCommand) {
  return Effect.callback<GitCommandOutput, GitCommandError>(
    (resume, signal) => {
      const child = execFile(
        "git",
        gitArguments(command),
        {
          encoding: "buffer",
          env: gitEnvironment(command),
          maxBuffer: command.maxOutputBytes ?? defaultMaximumOutputBytes,
          signal,
          timeout: command.timeoutMilliseconds ?? defaultTimeoutMilliseconds,
          windowsHide: true,
        },
        (error, output, errorOutput) => {
          const stdout = output.toString(command.outputEncoding ?? "utf8");
          const stderr = errorOutput.toString("utf8");
          if (error === null) {
            resume(Effect.succeed({ exitCode: 0, stderr, stdout }));
            return;
          }
          const exitCode = exitCodeOf(error);
          resume(
            exitCode === undefined
              ? Effect.fail(
                  new GitCommandError({
                    cause: error,
                    reason: failureReason(error),
                  }),
                )
              : Effect.succeed({ exitCode, stderr, stdout }),
          );
        },
      );
      child.stdin?.once("error", () => undefined);
      child.stdin?.end(command.input);
    },
  );
}

function streamLocalGitCommand(command: GitStreamCommand) {
  return Stream.unwrap(
    Effect.map(spawnGitProcess(command), (git) =>
      Stream.fromReadableStream({
        evaluate: () =>
          Readable.toWeb(
            git.child.stdout,
          ) as unknown as ReadableStream<Uint8Array>,
        onError: (cause) => new GitCommandError({ cause, reason: "Failed" }),
      }).pipe(
        Stream.decodeText,
        Stream.concat(Stream.fromEffectDrain(Deferred.await(git.exit))),
      ),
    ),
  ).pipe(
    Stream.interruptWhen(
      Effect.sleep(
        command.timeoutMilliseconds ?? defaultTimeoutMilliseconds,
      ).pipe(
        Effect.andThen(Effect.fail(new GitCommandError({ reason: "Timeout" }))),
      ),
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
  const exit = Deferred.makeUnsafe<void, GitCommandError>();
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
        new GitCommandError({
          cause,
          reason: cause.code === "ENOENT" ? "GitUnavailable" : "Failed",
        }),
      ),
    );
  });
  child.once("close", (code) => {
    Deferred.doneUnsafe(
      exit,
      code === 0
        ? Effect.void
        : Effect.fail(
            new GitCommandError({
              reason: "Failed",
              stderr,
              ...(code === null ? {} : { exitCode: code }),
            }),
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
  return {
    ...process.env,
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

function failureReason(error: ExecFileException): GitCommandFailureReason {
  if (error.code === "ENOENT") return "GitUnavailable";
  if (error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return "OutputTooLarge";
  if (error.killed === true || error.code === "ETIMEDOUT") return "Timeout";
  return "Failed";
}
