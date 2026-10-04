import { Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { TerminalOutput } from "#contracts/terminal/terminal.contract.ts";
import {
  createTerminalSessions,
  terminalHistory,
} from "#server/features/terminal/terminal-sessions.ts";
import { fakeTerminalProcess } from "#tests-support/terminals.ts";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const main = { repositoryId, worktreePath: "/repo" };
const topic = { repositoryId, worktreePath: "/repo.worktrees/topic" };
const size = { cols: 80, rows: 24 };

function sessions() {
  const processes: ReturnType<typeof fakeTerminalProcess>[] = [];
  const changed: string[] = [];
  const terminals = createTerminalSessions(
    async () => {
      const process = fakeTerminalProcess();
      processes.push(process);
      return process;
    },
    (id) => changed.push(id),
  );
  const open = (worktree: typeof main) =>
    Effect.runPromise(terminals.open({ ...worktree, ...size }));
  const read = (id: string, since: number, count: number) =>
    Effect.runPromise(
      terminals.attach(id, since).pipe(Stream.take(count), Stream.runCollect),
    );
  return { terminals, processes, changed, open, read };
}

describe("terminal sessions", () => {
  it("numbers terminals per worktree and reuses the lowest free number", async () => {
    const { terminals, open, changed } = sessions();

    const first = await open(main);
    await open(main);
    await open(topic);
    terminals.close(first.id);
    const reopened = await open(main);

    expect(terminals.list(main).terminals.map(({ number }) => number)).toEqual([
      2, 1,
    ]);
    expect(terminals.list(topic).terminals.map(({ number }) => number)).toEqual(
      [1],
    );
    expect(reopened.number).toBe(1);
    expect(changed).toHaveLength(5);
  });

  it("resumes output from the last offset the client rendered", async () => {
    const { open, processes, read } = sessions();
    const { id } = await open(main);

    processes[0]?.emit("one\r\n");
    const [first] = await read(id, 0, 1);
    processes[0]?.emit("two\r\n");
    const [resumed] = await read(
      id,
      first?._tag === "Output" ? first.end : 0,
      1,
    );

    expect(first).toEqual({ _tag: "Output", data: "one\r\n", end: 5 });
    expect(resumed).toEqual({ _tag: "Output", data: "two\r\n", end: 10 });
  });

  it("ends the stream and drops the terminal when the shell exits", async () => {
    const { terminals, open, processes } = sessions();
    const { id } = await open(main);
    const seen: TerminalOutput[] = [];

    processes[0]?.emit("bye\r\n");
    await Effect.runPromise(
      terminals.attach(id, 0).pipe(
        Stream.runForEach((output) =>
          Effect.sync(() => {
            seen.push(output);
            if (output._tag === "Output") processes[0]?.exit();
          }),
        ),
      ),
    );

    expect(seen).toEqual([
      { _tag: "Output", data: "bye\r\n", end: 5 },
      { _tag: "Exited" },
    ]);
    expect(terminals.list(main).terminals).toEqual([]);
  });

  it("forwards input and size to the shell and kills it on close", async () => {
    const { terminals, open, processes } = sessions();
    const { id } = await open(main);

    terminals.write(id, "ls\r");
    terminals.resize(id, 120, 40);
    terminals.close(id);
    terminals.write(id, "ignored");

    expect(processes[0]).toMatchObject({
      writes: ["ls\r"],
      sizes: [[120, 40]],
      killed: true,
    });
  });
});

describe("terminal history", () => {
  it("drops whole old lines and resets a client that fell behind", () => {
    const history = terminalHistory(10);

    history.append("first\nsecond\nthird");

    expect(history.read(0)).toEqual({
      _tag: "Reset",
      data: "third",
      end: 18,
    });
    expect(history.read(13)).toEqual({
      _tag: "Output",
      data: "third",
      end: 18,
    });
  });
});
