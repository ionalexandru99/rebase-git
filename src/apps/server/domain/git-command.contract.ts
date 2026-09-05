import { Context, Data, type Effect } from "effect";

export interface GitCommand {
  readonly arguments: readonly string[];
  readonly directory: string;
  readonly input?: string;
  readonly maxOutputBytes?: number;
  readonly timeoutMilliseconds?: number;
}

export interface GitCommandOutput {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface GitCommandRunner {
  readonly run: (
    command: GitCommand,
  ) => Effect.Effect<GitCommandOutput, GitCommandError>;
  readonly stream?: (
    command: GitCommand,
    onStdout: (chunk: string, signal: AbortSignal) => Promise<void>,
  ) => Effect.Effect<Omit<GitCommandOutput, "stdout">, GitCommandError>;
}

export type GitCommandFailureReason =
  | "GitUnavailable"
  | "Timeout"
  | "OutputTooLarge"
  | "Failed";

export class GitCommands extends Context.Service<
  GitCommands,
  GitCommandRunner
>()("GitCommands") {}

export class GitCommandError extends Data.TaggedError("GitCommandError")<{
  readonly cause?: unknown;
  readonly reason: GitCommandFailureReason;
}> {}
