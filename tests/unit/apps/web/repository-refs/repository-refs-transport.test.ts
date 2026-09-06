import {
  fragmentJsonMessage,
  ReadRepositoryRefsMessage,
  type RepositoryRefs,
} from "@rebase/contracts";
import { Effect, Fiber, Schema } from "effect";
import { expect, it, vi } from "vite-plus/test";
import { RepositoryRefsResponseError } from "#web/features/repository-refs/repository-refs-client.contract";
import { createRepositoryRefsTransport } from "#web/features/repository-refs/transport/repository-refs-transport";

const repositoryId = "00000000-0000-4000-8000-000000000001";

it("cancels an interrupted refs read and releases its pending fragments", async () => {
  const send = vi.fn();
  const transport = createRepositoryRefsTransport({ send }, true);
  const read = Effect.runFork(transport.read(repositoryId));
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  const request = Schema.decodeUnknownSync(ReadRepositoryRefsMessage)(
    JSON.parse(String(send.mock.calls[0]?.[0])),
  );
  await Effect.runPromise(Fiber.interrupt(read));
  expect(JSON.parse(String(send.mock.calls[1]?.[0]))).toEqual({
    _tag: "CancelRepositoryRefs",
    requestId: request.requestId,
  });
  expect(transport.hasRequest(request.requestId)).toBe(false);
});

it("fails pending and future reads when the connection closes", async () => {
  const send = vi.fn();
  const transport = createRepositoryRefsTransport({ send }, true);
  const read = Effect.runFork(transport.read(repositoryId));
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  await Effect.runPromise(transport.close);
  await expect(Effect.runPromise(Fiber.join(read))).rejects.toEqual(
    new RepositoryRefsResponseError(),
  );
  await expect(Effect.runPromise(transport.read(repositoryId))).rejects.toEqual(
    new RepositoryRefsResponseError(),
  );
  expect(send).toHaveBeenCalledOnce();
});

it("rejects a snapshot for a different repository", async () => {
  const send = vi.fn();
  const transport = createRepositoryRefsTransport({ send }, true);
  const read = Effect.runFork(transport.read(repositoryId));
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  const request = Schema.decodeUnknownSync(ReadRepositoryRefsMessage)(
    JSON.parse(String(send.mock.calls[0]?.[0])),
  );
  const refs: RepositoryRefs = {
    repositoryId: "00000000-0000-4000-8000-000000000002",
    branches: [],
    remoteBranches: [],
    tags: [],
    worktrees: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
  };
  const frames = fragmentJsonMessage(
    {
      logicalMessageId: 1,
      requestId: request.requestId,
      payload: new TextEncoder().encode(JSON.stringify(refs)),
    },
    16_384,
  );
  try {
    await expect(
      Effect.runPromise(
        Effect.forEach(frames, (frame) => transport.acceptJson(frame)),
      ),
    ).rejects.toMatchObject({ _tag: "EnvironmentResponseError" });
  } finally {
    await Effect.runPromise(Fiber.interrupt(read));
  }
});
