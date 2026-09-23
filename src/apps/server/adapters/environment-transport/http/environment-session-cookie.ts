import type { IncomingMessage, ServerResponse } from "node:http";

export function readBrowserSessionCredential(request: IncomingMessage) {
  const prefix = `${cookieName(request)}=`;
  return request.headers.cookie
    ?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}

export function writeBrowserSessionCookie(
  request: IncomingMessage,
  response: ServerResponse,
  credential: string,
) {
  response.setHeader(
    "set-cookie",
    `${cookieName(request)}=${credential}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${90 * 24 * 60 * 60}`,
  );
}

function cookieName(request: IncomingMessage) {
  return `rebase_session_${request.socket.localPort}`;
}
