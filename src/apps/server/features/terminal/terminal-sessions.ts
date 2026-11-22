import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CloseTerminal,
  OpenTerminal,
  Terminal,
  TerminalOutput,
  Terminals,
  TerminalUnavailable,
  TerminalWorktree,
} from "#contracts/terminal/terminal.contract.ts";

const historyLimit = 1_048_576;
const exited: TerminalOutput = { _tag: "Exited" };

export interface TerminalProcess {
  readonly write: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly kill: () => void;
  readonly onData: (listener: (data: string) => void) => unknown;
  readonly onExit: (listener: () => void) => unknown;
}

export type SpawnShell = (options: {
  readonly cwd: string;
  readonly cols: number;
  readonly rows: number;
}) => Promise<TerminalProcess>;

interface TerminalSession extends Terminal, TerminalWorktree {
  readonly process: TerminalProcess;
  readonly history: TerminalHistory;
  readonly listeners: Set<() => void>;
  exited: boolean;
}

export type TerminalSessions = ReturnType<typeof createTerminalSessions>;

export function acquireTerminalSessions(
  changed: (repositoryId: string) => void,
) {
  return createTerminalSessions(spawnShell, changed);
}

export function createTerminalSessions(
  spawn: SpawnShell,
  changed: (repositoryId: string) => void,
) {
  const sessions = new Map<string, TerminalSession>();
  const inWorktree = ({ repositoryId, worktreePath }: TerminalWorktree) =>
    [...sessions.values()].filter(
      (session) =>
        session.repositoryId === repositoryId &&
        session.worktreePath === worktreePath,
    );
  const finish = (session: TerminalSession) => {
    if (!sessions.delete(session.id)) return;
    session.exited = true;
    for (const wake of session.listeners) wake();
    changed(session.repositoryId);
  };
  const start = (
    { cols, rows, ...worktree }: OpenTerminal,
    process: TerminalProcess,
  ): Terminal => {
    const used = new Set(inWorktree(worktree).map(({ number }) => number));
    let number = 1;
    while (used.has(number)) number += 1;
    const session: TerminalSession = {
      id: randomUUID(),
      number,
      ...worktree,
      process,
      history: terminalHistory(historyLimit),
      listeners: new Set(),
      exited: false,
    };
    sessions.set(session.id, session);
    process.onData((data) => {
      session.history.append(data);
      for (const wake of session.listeners) wake();
    });
    process.onExit(() => finish(session));
    changed(worktree.repositoryId);
    return { id: session.id, number };
  };
  return {
    list: (worktree: TerminalWorktree): Terminals => ({
      terminals: inWorktree(worktree).map(({ id, number }) => ({ id, number })),
    }),
    open: async (input: OpenTerminal) => {
      let process: TerminalProcess;
      try {
        process = await spawn({
          cwd: input.worktreePath,
          cols: input.cols,
          rows: input.rows,
        });
      } catch (error) {
        throw {
          _tag: "TerminalUnavailable",
          detail: error instanceof Error ? error.message : String(error),
        } satisfies TerminalUnavailable;
      }
      return start(input, process);
    },
    write: (id: string, data: string) =>
      ignoreClosed(() => sessions.get(id)?.process.write(data)),
    resize: (id: string, cols: number, rows: number) =>
      ignoreClosed(() => sessions.get(id)?.process.resize(cols, rows)),
    closeTerminal: ({ id, repositoryId, worktreePath }: CloseTerminal) => {
      const session = sessions.get(id);
      if (
        session === undefined ||
        session.repositoryId !== repositoryId ||
        session.worktreePath !== worktreePath
      )
        return;
      finish(session);
      ignoreClosed(session.process.kill);
    },
    attach: async function* (
      id: string,
      since: number,
      signal: AbortSignal,
    ): AsyncGenerator<TerminalOutput> {
      const session = sessions.get(id);
      if (session === undefined) {
        yield exited;
        return;
      }
      let woken = true;
      let wake: (() => void) | undefined;
      const listener = () => {
        woken = true;
        wake?.();
      };
      session.listeners.add(listener);
      signal.addEventListener("abort", listener);
      let cursor = since;
      try {
        while (!signal.aborted) {
          if (!woken) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            continue;
          }
          woken = false;
          if (cursor !== session.history.end) {
            const output = session.history.read(cursor);
            cursor = output.end;
            yield output;
          }
          if (session.exited) {
            yield exited;
            return;
          }
        }
      } finally {
        session.listeners.delete(listener);
        signal.removeEventListener("abort", listener);
      }
    },
    close: () => {
      for (const session of [...sessions.values()]) {
        sessions.delete(session.id);
        ignoreClosed(session.process.kill);
      }
    },
  };
}

export type TerminalHistory = ReturnType<typeof terminalHistory>;

export function terminalHistory(limit: number) {
  let start = 0;
  let text = "";
  return {
    get end() {
      return start + text.length;
    },
    append: (data: string) => {
      text += data;
      if (text.length <= limit) return;
      const excess = text.length - limit;
      const lineStart = text.indexOf("\n", excess) + 1;
      const cut = lineStart > 0 ? lineStart : excess;
      text = text.slice(cut);
      start += cut;
    },
    read: (
      since: number,
    ): Extract<TerminalOutput, { readonly _tag: "Output" | "Reset" }> =>
      since >= start && since <= start + text.length
        ? {
            _tag: "Output",
            data: text.slice(since - start),
            end: start + text.length,
          }
        : { _tag: "Reset", data: text, end: start + text.length },
  };
}

const spawnShell: SpawnShell = async ({ cwd, cols, rows }) => {
  const { spawn } = await import("@lydell/node-pty");
  const shell = defaultShell();
  const environment: Record<string, string | undefined> = {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
  };
  delete environment.ELECTRON_RUN_AS_NODE;
  return spawn(shell.file, shell.args, {
    name: "xterm-256color",
    cwd,
    cols,
    rows,
    env: environment,
  });
};

function defaultShell(): { readonly file: string; readonly args: string[] } {
  if (process.platform === "win32") {
    const powershell = [
      join(
        process.env.ProgramFiles ?? "C:\\Program Files",
        "PowerShell",
        "7",
        "pwsh.exe",
      ),
      join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
    ].find((candidate) => existsSync(candidate));
    return powershell === undefined
      ? { file: process.env.ComSpec ?? "cmd.exe", args: [] }
      : { file: powershell, args: ["-NoLogo"] };
  }
  const shell =
    [process.env.SHELL, "/bin/zsh", "/bin/bash"].find(
      (candidate): candidate is string =>
        candidate !== undefined && candidate !== "" && existsSync(candidate),
    ) ?? "/bin/sh";
  return { file: shell, args: process.platform === "darwin" ? ["-l"] : [] };
}

function ignoreClosed(action: () => void) {
  try {
    action();
  } catch {}
}
