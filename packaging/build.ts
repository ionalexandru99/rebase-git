import { execFile } from "node:child_process";
import { chmod, cp, mkdir, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { build } from "esbuild";

const execute = promisify(execFile);
const packageMetadata = JSON.parse(await readFile("package.json", "utf8")) as {
  readonly version: string;
};
const outputDirectory = "dist";

await rm(outputDirectory, { force: true, recursive: true });
await execute(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["--filter", "@rebase/web", "build:web"],
  {
    env: {
      ...process.env,
      REBASE_PRODUCT_VERSION: packageMetadata.version,
    },
  },
);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  cp(
    "src/apps/server/persistence/migrations",
    `${outputDirectory}/migrations`,
    {
      recursive: true,
    },
  ),
  cp("src/apps/web/dist/web", `${outputDirectory}/web`, { recursive: true }),
]);

await Promise.all([
  build({
    bundle: true,
    conditions: ["rebase-source", "node", "import"],
    define: {
      REBASE_PRODUCT_VERSION: JSON.stringify(packageMetadata.version),
    },
    entryPoints: ["src/apps/server/cli.ts"],
    external: ["drizzle-orm", "drizzle-orm/*", "effect", "ws"],
    format: "esm",
    minifySyntax: true,
    outfile: `${outputDirectory}/runtime.js`,
    platform: "node",
    target: "node24",
  }),
  build({
    bundle: false,
    entryPoints: ["src/apps/server/package-cli.ts"],
    format: "esm",
    outfile: `${outputDirectory}/cli.js`,
    platform: "node",
    target: "node24",
  }),
]);
await chmod(`${outputDirectory}/cli.js`, 0o755);
