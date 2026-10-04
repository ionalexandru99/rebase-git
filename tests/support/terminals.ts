import {
  type AttachTerminal,
  type ResizeTerminal,
  type Terminal,
  type TerminalOutput,
  TerminalsApi,
  type WriteTerminal,
} from "#contracts/terminal/terminal.contract.ts";
import type { TerminalProcess } from "#server/features/terminal/terminal-sessions.ts";
import { respond } from "#tests-support/fake-requests.ts";
import type { EnvironmentSubscriptions } from "#web/platform/query/environment-context.tsx";

export function fakeTerminalProcess() {
  const dataListeners = new Set<(data: string) => void>();
  const exitListeners = new Set<() => void>();
  const process = {
    writes: [] as string[],
    sizes: [] as (readonly [number, number])[],
    killed: false,
    write: (data: string) => {
      process.writes.push(data);
    },
    resize: (cols: number, rows: number) => {
      process.sizes.push([cols, rows]);
    },
    kill: () => {
      process.killed = true;
    },
    onData: (listener: (data: string) => void) => dataListeners.add(listener),
    onExit: (listener: () => void) => exitListeners.add(listener),
    emit: (data: string) => {
      for (const listener of dataListeners) listener(data);
    },
    exit: () => {
      for (const listener of exitListeners) listener();
    },
  } satisfies TerminalProcess & Record<string, unknown>;
  return process;
}

export function fakeTerminalServer() {
  const terminals: Terminal[] = [];
  const outputs = new Map<
    string,
    { end: number; accept: Set<(output: TerminalOutput) => void> }
  >();
  const writes: WriteTerminal[] = [];
  const sizes: ResizeTerminal[] = [];
  let gate = Promise.resolve();
  let opened = 0;
  const stream = (id: string) => {
    const current = outputs.get(id) ?? { end: 0, accept: new Set() };
    outputs.set(id, current);
    return current;
  };
  const send = (id: string, output: TerminalOutput) => {
    for (const accept of stream(id).accept) accept(output);
  };
  const remove = (id: string) => {
    const index = terminals.findIndex((terminal) => terminal.id === id);
    if (index >= 0) terminals.splice(index, 1);
    send(id, { _tag: "Exited" });
  };
  const subscribe: EnvironmentSubscriptions = async (
    route,
    input,
    accept,
    signal,
  ) => {
    if (route._tag !== TerminalsApi.attach._tag)
      throw new Error(`Unexpected subscription to ${route._tag}`);
    const listeners = stream((input as AttachTerminal).id).accept;
    const listener = accept as (output: TerminalOutput) => void;
    listeners.add(listener);
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    listeners.delete(listener);
  };
  return {
    routes: [
      respond(TerminalsApi.list, () => ({ terminals: [...terminals] })),
      respond(TerminalsApi.open, () => {
        const used = new Set(terminals.map(({ number }) => number));
        let number = 1;
        while (used.has(number)) number += 1;
        opened += 1;
        const terminal = {
          id: `00000000-0000-4000-8000-${String(opened).padStart(12, "0")}`,
          number,
        };
        terminals.push(terminal);
        return terminal;
      }),
      respond(TerminalsApi.close, ({ id }) => {
        remove(id);
        return {};
      }),
      respond(TerminalsApi.write, async (input) => {
        writes.push(input);
        await gate;
        return {};
      }),
      respond(TerminalsApi.resize, (input) => {
        sizes.push(input);
        return {};
      }),
    ],
    subscribe,
    writes,
    sizes,
    terminals,
    attached: (id: string) => stream(id).accept.size > 0,
    emit: (id: string, data: string) => {
      const current = stream(id);
      current.end += data.length;
      send(id, { _tag: "Output", data, end: current.end });
    },
    exit: remove,
    holdWrites: () => {
      let release = () => {};
      gate = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        gate = Promise.resolve();
        release();
      };
    },
  };
}
