import { homedir } from "node:os";
import type {
  EnvironmentProcessCommand,
  EnvironmentProcessMessage,
} from "#desktop/platform/environment/environment-supervisor.ts";
import { startEnvironmentServer } from "#server/app/server/serve-environment.ts";

async function serveUntilStopped() {
  const stop = Promise.withResolvers<void>();
  const requestStop = () => stop.resolve();
  const receive = ({ data }: Electron.MessageEvent) => {
    if ((data as EnvironmentProcessCommand).type === "stop") requestStop();
  };
  process.parentPort.on("message", receive);
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  try {
    const { close, ...server } = await startEnvironmentServer({
      home: homedir(),
      pairingReplacesGrantsWithSameLabel: true,
    });
    try {
      post({ type: "ready", server });
      await stop.promise;
    } finally {
      await close();
    }
  } finally {
    process.parentPort.off("message", receive);
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
  }
}

function post(message: EnvironmentProcessMessage) {
  process.parentPort.postMessage(message);
}

serveUntilStopped().then(
  () => process.exit(0),
  (error: unknown) =>
    post({
      type: "failed",
      message: error instanceof Error ? error.message : String(error),
    }),
);
