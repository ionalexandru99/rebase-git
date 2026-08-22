#!/usr/bin/env node

const requiredNodeMajor: number = 24;
const currentNodeMajor = Number(process.versions.node.split(".", 1)[0]);

if (currentNodeMajor !== requiredNodeMajor) {
  process.stderr.write(
    `rebase failed: Node 24 is required. Found Node ${process.versions.node}.\n`,
  );
  process.exitCode = 1;
} else {
  const runtimeModule = "./runtime.js";
  const { main } = await import(runtimeModule);
  await main();
}
