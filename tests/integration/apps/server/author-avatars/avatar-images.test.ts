import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import { createAvatarImages } from "#server/features/author-avatars/author-avatars.ts";

async function imageServer() {
  const server = createServer((request, response) => {
    if (request.url === "/avatar.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.from([1, 2, 3]));
    } else if (request.url === "/large.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(Buffer.alloc(300_000));
    } else {
      response.writeHead(302, { location: "/avatar.png" });
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const { port } = server.address() as AddressInfo;
  return (path: string) =>
    Effect.runPromise(
      createAvatarImages().download({ url: `http://127.0.0.1:${port}${path}` }),
    );
}

describe("avatar images", () => {
  it("returns an image as a data URL but not a redirect or an oversized image", async () => {
    const download = await imageServer();

    await expect(download("/avatar.png")).resolves.toBe(
      "data:image/png;base64,AQID",
    );
    await expect(download("/moved")).resolves.toBeUndefined();
    await expect(download("/large.png")).resolves.toBeUndefined();
  });
});
