import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { DesktopRenderer } from "#desktop/app/desktop-application.ts";

export type TrustedIpcHandler = <Arguments extends readonly unknown[], Result>(
  handler: (event: IpcMainInvokeEvent, ...arguments_: Arguments) => Result,
) => (event: IpcMainInvokeEvent, ...arguments_: Arguments) => Result;

export function isTrustedRendererLocation(
  renderer: DesktopRenderer,
  target: string,
) {
  const targetUrl = new URL(target);
  if (renderer.type === "url") {
    return targetUrl.origin === new URL(renderer.url).origin;
  }
  return (
    targetUrl.protocol === "file:" &&
    fileURLToPath(targetUrl) === resolve(renderer.path)
  );
}

const pullRequestHosts = new Set(["github.com", "dev.azure.com"]);

export function isExternalPullRequestLink(target: string) {
  const targetUrl = URL.parse(target);
  return (
    targetUrl?.protocol === "https:" && pullRequestHosts.has(targetUrl.host)
  );
}

export function createTrustedIpcHandler(
  renderer: DesktopRenderer,
): TrustedIpcHandler {
  return (handler) =>
    (event, ...arguments_) => {
      if (!isTrustedSender(event, renderer)) {
        throw new Error("Desktop commands require the main Rebase window.");
      }
      return handler(event, ...arguments_);
    };
}

function isTrustedSender(event: IpcMainInvokeEvent, renderer: DesktopRenderer) {
  const window = BrowserWindow.fromWebContents(event.sender);
  const frame = event.senderFrame;
  return (
    window !== null &&
    !window.isDestroyed() &&
    frame !== null &&
    frame === event.sender.mainFrame &&
    isTrustedRendererLocation(renderer, frame.url)
  );
}
