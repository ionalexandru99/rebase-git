import { exchangeEnvironmentPairingEffect } from "@rebase/web/features/environment-connection";
import { Effect } from "effect";
import type {
  DesktopApplicationHost,
  DesktopApplicationOptions,
  DesktopQuitEvent,
  DesktopRenderer,
} from "#desktop/features/desktop-application/desktop-application.contract";
import type { ManagedEnvironmentServer } from "#desktop/features/environment-supervision/environment-supervisor.contract";

export async function startDesktopApplication(
  options: DesktopApplicationOptions,
) {
  const environment = await options.startEnvironment();
  try {
    const { credential } = await Effect.runPromise(
      exchangeEnvironmentPairingEffect(environment.origin, {
        label: "Rebase desktop",
        pairingMaterial: new URL(environment.pairingUrl).hash.slice(1),
      }),
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
