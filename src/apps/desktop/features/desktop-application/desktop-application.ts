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
  const application = new DesktopApplication(
    options.host,
    options.renderer,
    environment,
  );

  try {
    await application.activate();
    return application;
  } catch (error) {
    await application.stop();
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
  ) {}

  async activate() {
    if (this.shutdown !== undefined || this.host.hasOpenWindows()) return;

    await this.host.openWindow({
      environmentOrigin: this.environment.origin,
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
