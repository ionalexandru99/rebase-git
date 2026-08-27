import { type ExecFileException, execFile } from "node:child_process";
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
  };
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
