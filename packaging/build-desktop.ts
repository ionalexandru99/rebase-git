import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { build } from "esbuild";

const execute = promisify(execFile);
const packageMetadata = JSON.parse(await readFile("package.json", "utf8")) as {
  readonly version: string;
};
const outputDirectory = "src/apps/desktop/dist/package";
const productVersion = process.env.RELEASE_VERSION ?? packageMetadata.version;

await rm(outputDirectory, { force: true, recursive: true });
await execute(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["--filter", "@rebase/web", "build:web"],
  {
    env: {
      ...process.env,
      REBASE_PRODUCT_VERSION: productVersion,
    },
  },
);

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
    entryPoints: ["src/apps/desktop/preload.ts"],
    external: ["electron"],
    format: "cjs",
    minifySyntax: true,
    outfile: `${outputDirectory}/preload.cjs`,
    platform: "node",
    target: "node24",
  }),
]);
