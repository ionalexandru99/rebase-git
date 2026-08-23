import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { build } from "esbuild";

const packageMetadata = JSON.parse(await readFile("package.json", "utf8")) as {
  readonly version: string;
};
const outputDirectory = "src/apps/desktop/dist/package";
const productVersion = process.env.RELEASE_VERSION ?? packageMetadata.version;
const execute = promisify(execFile);
const packageManagerCommand =
  process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
const packageManagerArguments =
  process.platform === "win32"
    ? ["/d", "/c", "pnpm.cmd", "build:web"]
    : ["build:web"];

await execute(packageManagerCommand, packageManagerArguments, {
  env: { ...process.env, REBASE_PRODUCT_VERSION: productVersion },
});

await rm(outputDirectory, { force: true, recursive: true });
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  cp("src/apps/desktop/assets", `${outputDirectory}/assets`, {
    recursive: true,
  }),
  cp(
    "src/apps/server/persistence/migrations",
    `${outputDirectory}/migrations`,
    { recursive: true },
  ),
  cp("src/apps/web/dist/web", `${outputDirectory}/web`, { recursive: true }),
  build({
    banner: {
      js: 'import { createRequire as createNodeRequire } from "node:module"; const require = createNodeRequire(import.meta.url);',
    },
    bundle: true,
    conditions: ["rebase-source", "node", "import"],
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
      REBASE_PRODUCT_VERSION: JSON.stringify(productVersion),
    },
    entryPoints: ["src/apps/desktop/main.ts"],
    external: ["drizzle-orm", "drizzle-orm/*", "effect", "electron", "ws"],
    format: "esm",
    minifySyntax: true,
    outfile: `${outputDirectory}/main.js`,
    platform: "node",
    target: "node24",
  }),
  build({
    bundle: true,
    conditions: ["rebase-source", "node", "import"],
    entryPoints: ["src/apps/desktop/preload.ts"],
    external: ["electron"],
    format: "cjs",
    minifySyntax: true,
    outfile: `${outputDirectory}/preload.cjs`,
    platform: "node",
    target: "node24",
  }),
]);
