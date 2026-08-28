#!/usr/bin/env node

const [currentNodeMajor, currentNodeMinor] = process.versions.node
  .split(".", 2)
  .map(Number);
const supportsNode =
  currentNodeMajor === 24 ||
  (currentNodeMajor === 22 &&
    currentNodeMinor !== undefined &&
    currentNodeMinor >= 18);

if (!supportsNode) {
  process.stderr.write(
    `rebase failed: Node 22.18 or 24 is required. Found Node ${process.versions.node}.\n`,
  );
  process.exitCode = 1;
} else {
  const runtimeModule = "./runtime.js";
  const { main } = await import(runtimeModule);
  await main();
}
