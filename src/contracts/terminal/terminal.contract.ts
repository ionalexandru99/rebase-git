import { Schema } from "effect";
import { Rpc } from "effect/rpc";
import {
  repositoryCommand,
  repositoryQuery,
  route,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const terminalWriteLimit = 65_536;

const TerminalId = Schema.String.check(Schema.isUUID(4));

const TerminalWorktree = Schema.Struct({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
});
export type TerminalWorktree = typeof TerminalWorktree.Type;

const TerminalSize = Schema.Struct({
  cols: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 1_000 })),
  rows: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
});
export type TerminalSize = typeof TerminalSize.Type;

export const Terminal = Schema.Struct({
  id: TerminalId,
  number: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type Terminal = typeof Terminal.Type;

export const Terminals = Schema.Struct({
  terminals: Schema.Array(Terminal).check(Schema.isMaxLength(256)),
});
export type Terminals = typeof Terminals.Type;

export const OpenTerminal = Schema.Struct({
  ...TerminalWorktree.fields,
  ...TerminalSize.fields,
});
export type OpenTerminal = typeof OpenTerminal.Type;

export const CloseTerminal = Schema.Struct({
  ...TerminalWorktree.fields,
  id: TerminalId,
});
export type CloseTerminal = typeof CloseTerminal.Type;

export const WriteTerminal = Schema.Struct({
  id: TerminalId,
  data: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(terminalWriteLimit),
  ),
});
export type WriteTerminal = typeof WriteTerminal.Type;

export const ResizeTerminal = Schema.Struct({
  id: TerminalId,
  ...TerminalSize.fields,
});
export type ResizeTerminal = typeof ResizeTerminal.Type;

export const AttachTerminal = Schema.Struct({
  id: TerminalId,
  since: Schema.Natural,
});
export type AttachTerminal = typeof AttachTerminal.Type;

export const TerminalOutput = Schema.Union([
  Schema.TaggedStruct("Output", { data: Schema.String, end: Schema.Natural }),
  Schema.TaggedStruct("Reset", { data: Schema.String, end: Schema.Natural }),
  Schema.TaggedStruct("Exited", {}),
]);
export type TerminalOutput = typeof TerminalOutput.Type;

export const TerminalUnavailable = Schema.TaggedStruct("TerminalUnavailable", {
  detail: Schema.String,
});
export type TerminalUnavailable = typeof TerminalUnavailable.Type;

export const TerminalsApi = {
  list: repositoryQuery("terminals/list", {
    request: TerminalWorktree,
    success: Terminals,
  }),
  open: repositoryCommand("terminals/open", {
    request: OpenTerminal,
    success: Terminal,
    failure: TerminalUnavailable,
  }),
  close: repositoryCommand("terminals/close", {
    request: CloseTerminal,
    success: Schema.Struct({}),
  }),
  write: route("terminals/write", {
    request: WriteTerminal,
    success: Schema.Struct({}),
  }),
  resize: route("terminals/resize", {
    request: ResizeTerminal,
    success: Schema.Struct({}),
  }),
  attach: Rpc.make("terminals/attach", {
    payload: AttachTerminal,
    success: TerminalOutput,
    stream: true,
  }),
};
