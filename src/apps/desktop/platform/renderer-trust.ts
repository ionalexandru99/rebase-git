import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { isPullRequestLink } from "#contracts/pull-requests/pull-requests.contract.ts";
import { GitHostKind } from "#contracts/source-control/source-control.contract.ts";
import {
  type ThirdPartyLicense,
  thirdPartyLicensesFile,
} from "#contracts/third-party-licenses/third-party-licenses.contract.ts";
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

export function isExternalPullRequestLink(target: string) {
  return GitHostKind.literals.some((kind) => isPullRequestLink(target, kind));
}

export async function licenseSourceLinks(
  renderer: DesktopRenderer,
): Promise<ReadonlySet<string>> {
  if (renderer.type === "url") return new Set();
  const licenses: readonly ThirdPartyLicense[] = await readFile(
    join(dirname(renderer.path), thirdPartyLicensesFile),
    "utf8",
  ).then(JSON.parse, () => []);
  return new Set(
    licenses.flatMap(({ sourceUrl }) =>
      sourceUrl === null ? [] : [sourceUrl],
    ),
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
