import { type ExecFileException, execFile, spawn } from "node:child_process";
import { Effect } from "effect";
import {
  type GitCommand,
  GitCommandError,
  type GitCommandFailureReason,
  type GitCommandOutput,
  type GitCommandRunner,
} from "#server/domain/git-command.contract";

const defaultTimeoutMilliseconds = 30_000;
const defaultMaximumOutputBytes = 16 * 1_048_576;

export function createLocalGitCommandRunner(): GitCommandRunner {
  return {
    run: (command) => runLocalGitCommand(command),
    stream: (command, onStdout) => streamLocalGitCommand(command, onStdout),
  };
}

function streamLocalGitCommand(
  command: GitCommand,
  onStdout: (chunk: string, signal: AbortSignal) => Promise<void>,
) {
  let timeoutSignal: AbortSignal | undefined;
  return Effect.tryPromise({
    try: async (signal) => {
      timeoutSignal = AbortSignal.timeout(
        command.timeoutMilliseconds ?? defaultTimeoutMilliseconds,
      );
      const streamFailureController = new AbortController();
      const combinedSignal = AbortSignal.any([
        signal,
        timeoutSignal,
        streamFailureController.signal,
      ]);
      const child = spawn(
        "git",
        ["-C", command.directory, ...command.arguments],
        {
          env: gitEnvironment(),
          signal: combinedSignal,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      child.stdin?.once("error", () => undefined);
      child.stdin?.end(command.input);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      let stderr = "";
      child.stderr.on("data", (chunk: string) => {
        if (stderr.length < defaultMaximumOutputBytes) {
          stderr += chunk.slice(0, defaultMaximumOutputBytes - stderr.length);
        }
      });
      const exited = childExit(child);
      try {
        for await (const chunk of child.stdout) {
          await onStdout(String(chunk), combinedSignal);
        }
      } catch (cause) {
        streamFailureController.abort();
        await exited.catch(() => undefined);
        throw cause;
      }
      const exitCode = await exited;
      return { exitCode, stderr };
    },
    catch: (cause) =>
      new GitCommandError({
        cause,
        reason:
          timeoutSignal?.aborted === true
            ? "Timeout"
            : streamFailureReason(cause),
      }),
  });
}

function childExit(child: ReturnType<typeof spawn>) {
  return new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function streamFailureReason(cause: unknown): GitCommandFailureReason {
  if (
    cause instanceof Error &&
    "code" in cause &&
    (cause as NodeJS.ErrnoException).code === "ENOENT"
  ) {
    return "GitUnavailable";
  }
  return "Failed";
}

function runLocalGitCommand(command: GitCommand) {
  return Effect.callback<GitCommandOutput, GitCommandError>(
    (resume, signal) => {
      execFile(
        "git",
        ["-C", command.directory, ...command.arguments],
        {
          encoding: "utf8",
          env: gitEnvironment(),
          maxBuffer: command.maxOutputBytes ?? defaultMaximumOutputBytes,
          signal,
          timeout: command.timeoutMilliseconds ?? defaultTimeoutMilliseconds,
          windowsHide: true,
        },
        (error, stdout, stderr) => {
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
    },
  );
}

function gitEnvironment() {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
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
