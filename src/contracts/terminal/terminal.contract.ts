import { z } from "zod";
import {
  repositoryCommand,
  repositoryQuery,
  route,
  streamRoute,
} from "#contracts/environment-connection/environment-route.contract.ts";
import {
  RepositoryId,
  RepositoryPath,
} from "#contracts/git/git-values.contract.ts";

export const terminalWriteLimit = 65_536;

const TerminalId = z.uuidv4();

const TerminalWorktree = z.object({
  repositoryId: RepositoryId,
  worktreePath: RepositoryPath,
});
export type TerminalWorktree = z.infer<typeof TerminalWorktree>;

const TerminalSize = z.object({
  cols: z.int().min(2).max(1_000),
  rows: z.int().min(1).max(500),
});
export type TerminalSize = z.infer<typeof TerminalSize>;

export const Terminal = z.object({
  id: TerminalId,
  number: z.int().gt(0),
});
export type Terminal = z.infer<typeof Terminal>;

export const Terminals = z.object({
  terminals: z.array(Terminal).max(256).readonly(),
});
export type Terminals = z.infer<typeof Terminals>;

export const OpenTerminal = z.object({
  ...TerminalWorktree.shape,
  ...TerminalSize.shape,
});
export type OpenTerminal = z.infer<typeof OpenTerminal>;

export const CloseTerminal = z.object({
  ...TerminalWorktree.shape,
  id: TerminalId,
});
export type CloseTerminal = z.infer<typeof CloseTerminal>;

export const WriteTerminal = z.object({
  id: TerminalId,
  data: z.string().min(1).max(terminalWriteLimit),
});
export type WriteTerminal = z.infer<typeof WriteTerminal>;

export const ResizeTerminal = z.object({
  id: TerminalId,
  ...TerminalSize.shape,
});
export type ResizeTerminal = z.infer<typeof ResizeTerminal>;

export const AttachTerminal = z.object({
  id: TerminalId,
  since: z.int().nonnegative(),
});
export type AttachTerminal = z.infer<typeof AttachTerminal>;

export const TerminalOutput = z.discriminatedUnion("_tag", [
  z.object({
    _tag: z.literal("Output"),
    data: z.string(),
    end: z.int().nonnegative(),
  }),
  z.object({
    _tag: z.literal("Reset"),
    data: z.string(),
    end: z.int().nonnegative(),
  }),
  z.object({ _tag: z.literal("Exited") }),
]);
export type TerminalOutput = z.infer<typeof TerminalOutput>;

export const TerminalUnavailable = z.object({
  _tag: z.literal("TerminalUnavailable"),
  detail: z.string(),
});
export type TerminalUnavailable = z.infer<typeof TerminalUnavailable>;

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
    success: z.object({}),
  }),
  write: route("terminals/write", {
    request: WriteTerminal,
    success: z.object({}),
  }),
  resize: route("terminals/resize", {
    request: ResizeTerminal,
    success: z.object({}),
  }),
  attach: streamRoute("terminals/attach", {
    request: AttachTerminal,
    success: TerminalOutput,
  }),
};
