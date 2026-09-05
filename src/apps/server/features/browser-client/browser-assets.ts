import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAbsolute, relative, resolve } from "node:path";
import { Effect } from "effect";
import { formatHostAddress } from "#server/features/environment-connection/environment-request-authorization";

const contentTypes: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

export function respondWithBrowserAsset(
  request: IncomingMessage,
  response: ServerResponse,
  assetsRoot: string,
) {
  const asset = resolveBrowserAsset(request.url, assetsRoot);
  if (asset === undefined) {
    return Effect.succeed(false);
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { allow: "GET, HEAD" }).end();
    return Effect.succeed(true);
  }

  return Effect.promise(async () => {
    try {
      const content = await readFile(asset.path);
      response.writeHead(
        200,
        browserAssetHeaders(
          asset.extension,
          asset.cache,
          formatHostAddress(request.socket.localAddress ?? "127.0.0.1"),
        ),
      );
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      const status = isMissingAsset(error) ? 404 : 500;
      response.writeHead(status).end();
    }
    return true;
  });
}

export function resolveBrowserAsset(
  url: string | undefined,
  assetsRoot: string,
) {
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(url ?? "/", "http://127.0.0.1").pathname,
    );
  } catch {
    return undefined;
  }

  const relativePath = browserAssetPath(pathname);
  if (relativePath === undefined) {
    return undefined;
  }

  const path = resolve(assetsRoot, relativePath);
  const pathFromRoot = relative(resolve(assetsRoot), path);
  if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    return undefined;
  }

  const extensionIndex = relativePath.lastIndexOf(".");
  return {
    cache: relativePath.startsWith("assets/"),
    extension: extensionIndex === -1 ? "" : relativePath.slice(extensionIndex),
    path,
  };
}

export function browserAssetPath(pathname: string) {
  if (pathname === "/" || pathname === "/pair" || pathname === "/pair/") {
    return "index.html";
  }
  if (
    pathname === "/favicon.svg" ||
    (pathname.startsWith("/assets/") && pathname !== "/assets/")
  ) {
    return pathname.slice(1);
  }
  return undefined;
}

function browserAssetHeaders(
  extension: string,
  cache: boolean,
  webSocketHost: string,
) {
  return {
    "cache-control": cache ? "public, max-age=31536000, immutable" : "no-store",
    "content-security-policy": `default-src 'self'; base-uri 'none'; connect-src 'self' ws://${webSocketHost}:* https://api.github.com; form-action 'none'; frame-ancestors 'none'; img-src 'self' data: https://avatars.githubusercontent.com; object-src 'none'; script-src 'self'; style-src 'self'`,
    "content-type": contentTypes[extension] ?? "application/octet-stream",
    "x-content-type-options": "nosniff",
  };
}

function isMissingAsset(error: unknown) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "EISDIR")
  );
}
