import { Context, Data, type Effect, type Stream } from "effect";

export interface GitCommand {
  readonly arguments: readonly string[];
  readonly directory: string;
  readonly globalArguments?: readonly string[];
  readonly input?: string;
  readonly indexFile?: string;
  readonly literalPathspecs?: boolean;
  readonly objectDirectory?: string;
  readonly outputEncoding?: "utf8" | "base64";
  readonly maxOutputBytes?: number;
  readonly timeoutMilliseconds?: number;
}

export type GitCommandOptions = Omit<GitCommand, "arguments" | "directory">;

export type GitStreamCommand = Omit<
  GitCommand,
  "outputEncoding" | "maxOutputBytes"
>;

export type GitStreamOptions = Omit<
  GitStreamCommand,
  "arguments" | "directory"
>;

export interface GitCommandOutput {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface GitCommandRunner {
  readonly run: (
    command: GitCommand,
  ) => Effect.Effect<GitCommandOutput, GitCommandError>;
  readonly stream: (
    command: GitStreamCommand,
  ) => Stream.Stream<string, GitCommandError>;
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
  readonly exitCode?: number;
  readonly reason: GitCommandFailureReason;
  readonly stderr?: string;
}> {}
