import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import { onTestFinished } from "vite-plus/test";
import { createRepository, git } from "#tests-support/git.ts";

const execute = promisify(execFile);

export async function createLargeFileRemote(root: string) {
  const remote = join(root, "remote.git");
  const author = join(root, "author");
  await git(root, "init", "--bare", "-b", "main", remote);
  await createRepository(author, { commits: [] });
  await git(author, "lfs", "install", "--local");
  await git(author, "lfs", "track", "*.bin");
  await git(author, "lfs", "track", "*.png");
  await writeFile(join(author, "logo.png"), png([56, 189, 248]));
  await writeFile(join(author, "level.bin"), Buffer.alloc(4_096));
  await git(author, "add", ".");
  await git(author, "commit", "-m", "Add large files");
  const url = pathToFileURL(remote).href;
  await git(author, "remote", "add", "origin", url);
  await git(author, "push", "-u", "origin", "main");
  return { remote, author, url };
}

export async function cloneLargeFiles(url: string, destination: string) {
  await execute(
    "git",
    ["clone", "--config", "core.autocrlf=false", url, destination],
    { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" } },
  );
  await git(destination, "lfs", "install", "--local");
  await git(destination, "lfs", "pull");
}

export function png([red, green, blue]: readonly [number, number, number]) {
  const size = 8;
  const row = Buffer.from([0, ...Array(size).fill([red, green, blue]).flat()]);
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ServedLock {
  readonly id: string;
  readonly path: string;
  readonly owner: { readonly name: string };
  readonly locked_at: string;
}

export async function serveLargeFileLocks({
  supported = true,
  locks = [],
}: {
  readonly supported?: boolean;
  readonly locks?: readonly { readonly path: string; readonly owner: string }[];
} = {}) {
  const held = new Map<string, ServedLock>();
  let next = 0;
  const add = (path: string, owner: string) => {
    next += 1;
    const lock = {
      id: String(next),
      path,
      owner: { name: owner },
      locked_at: "2026-10-08T00:00:00Z",
    };
    held.set(lock.id, lock);
    return lock;
  };
  for (const lock of locks) add(lock.path, lock.owner);
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const body =
      chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString());
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, {
        "Content-Type": "application/vnd.git-lfs+json",
      });
      response.end(JSON.stringify(value));
    };
    if (!supported) return reply(501, { message: "Not Implemented" });
    const url = new URL(request.url ?? "/", "http://localhost");
    const all = [...held.values()];
    if (request.method === "GET" && url.pathname === "/locks")
      return reply(200, {
        locks: all.filter(
          (lock) =>
            !url.searchParams.has("path") ||
            lock.path === url.searchParams.get("path"),
        ),
      });
    if (request.method === "POST" && url.pathname === "/locks/verify")
      return reply(200, {
        ours: all.filter((lock) => lock.owner.name === "you"),
        theirs: all.filter((lock) => lock.owner.name !== "you"),
      });
    if (request.method === "POST" && url.pathname === "/locks")
      return reply(201, { lock: add(body.path, "you") });
    const unlock = /^\/locks\/(\w+)\/unlock$/.exec(url.pathname);
    const lock = unlock?.[1] === undefined ? undefined : held.get(unlock[1]);
    if (request.method === "POST" && lock !== undefined) {
      if (lock.owner.name !== "you" && body.force !== true)
        return reply(403, { message: "Lock owned by someone else" });
      held.delete(lock.id);
      return reply(200, { lock });
    }
    reply(404, { message: "Not Found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    held: () =>
      [...held.values()].map(({ path, owner }) => ({
        path,
        owner: owner.name,
      })),
  };
}
