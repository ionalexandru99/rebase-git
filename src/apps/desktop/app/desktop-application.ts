import {
  EnvironmentPairingExchanged,
  type ExchangeEnvironmentPairing,
  environmentPairingExchangePath,
} from "@rebase/contracts";
import { Schema } from "effect";
import type { ManagedEnvironmentServer } from "#desktop/platform/environment/environment-supervisor";

export type DesktopRenderer =
  | { readonly type: "file"; readonly path: string }
  | { readonly type: "url"; readonly url: string };

export interface DesktopWindowOptions {
  readonly environmentOrigin: string;
  readonly credential: string;
  readonly renderer: DesktopRenderer;
}

export interface DesktopApplicationHost {
  readonly platform: NodeJS.Platform;
  hasOpenWindows(): boolean;
  openWindow(options: DesktopWindowOptions): Promise<void> | void;
  quit(): void;
}

export interface DesktopQuitEvent {
  preventDefault(): void;
}

export interface DesktopApplicationOptions {
  readonly host: DesktopApplicationHost;
  readonly renderer: DesktopRenderer;
  readonly startEnvironment: () => Promise<ManagedEnvironmentServer>;
}

export async function startDesktopApplication(
  options: DesktopApplicationOptions,
) {
  const environment = await options.startEnvironment();
  try {
    const { credential } = await exchangeEnvironmentPairing(
      environment.origin,
      {
        label: "Rebase desktop",
        pairingMaterial: new URL(environment.pairingUrl).hash.slice(1),
      },
    );
    const application = new DesktopApplication(
      options.host,
      options.renderer,
      environment,
      credential,
    );
    await application.activate();
    return application;
  } catch (error) {
    await environment.stop();
    throw error;
  }
}

async function exchangeEnvironmentPairing(
  origin: string,
  exchange: ExchangeEnvironmentPairing,
) {
  const response = await fetch(
    new URL(environmentPairingExchangePath, origin),
    {
      body: JSON.stringify(exchange),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  const body: unknown = await response.json();
  if (!response.ok)
    throw new Error(`The Environment refused pairing: ${JSON.stringify(body)}`);
  return Schema.decodeUnknownSync(EnvironmentPairingExchanged)(body);
}

export class DesktopApplication {
  private shutdown: Promise<void> | undefined;
  private stopped = false;

  constructor(
    private readonly host: DesktopApplicationHost,
    private readonly renderer: DesktopRenderer,
    private readonly environment: ManagedEnvironmentServer,
    private readonly credential: string,
  ) {}

  async activate() {
    if (this.shutdown !== undefined || this.host.hasOpenWindows()) return;

    await this.host.openWindow({
      environmentOrigin: this.environment.origin,
      credential: this.credential,
      renderer: this.renderer,
    });
  }

  async beforeQuit(event: DesktopQuitEvent) {
    if (this.stopped) return;

    event.preventDefault();
    await this.stopAndQuit();
  }

  async windowAllClosed() {
    if (this.host.platform !== "darwin") {
      await this.stopAndQuit();
    }
  }

  stop() {
    this.shutdown ??= this.environment.stop().finally(() => {
      this.stopped = true;
    });
    return this.shutdown;
  }

  private async stopAndQuit() {
    await this.stop();
    this.host.quit();
  }
}
