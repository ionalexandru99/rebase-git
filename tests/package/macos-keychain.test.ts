import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);

test("imports a signing certificate into an independently password-protected keychain", {
  skip: process.platform !== "darwin",
  timeout: 60_000,
}, async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "rebase-signing-"));
  const { stdout } = await execute("/usr/bin/security", [
    "list-keychains",
    "-d",
    "user",
  ]);
  const keychains = stdout
    .split("\n")
    .map((line) => line.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

  process.env.APP_BUILDER_TMP_DIR = directory;
  process.env.ELECTRON_BUILDER_CACHE = join(directory, "cache");

  const requireBuilder = createRequire(import.meta.resolve("electron-builder"));
  const requireAppBuilder = createRequire(
    requireBuilder.resolve("app-builder-lib"),
  );
  const { createKeychain } = requireAppBuilder(
    "app-builder-lib/out/codeSign/macCodeSign.js",
  );
  const { TmpDir } = requireAppBuilder("temp-file");
  const temporaryFiles = new TmpDir();

  context.after(async () => {
    try {
      for (const file of await readdir(directory)) {
        if (file.endsWith(".keychain") || file.endsWith(".keychain-db")) {
          await execute("/usr/bin/security", [
            "delete-keychain",
            join(directory, file),
          ]);
        }
      }
    } finally {
      await execute("/usr/bin/security", [
        "list-keychains",
        "-d",
        "user",
        "-s",
        ...keychains,
      ]);
      await temporaryFiles.cleanup();
      await rm(directory, { recursive: true, force: true });
    }
  });

  await execute("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(directory, "key.pem"),
    "-out",
    join(directory, "certificate.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=Rebase signing test",
  ]);
  const certificate = join(directory, "certificate.p12");
  const password = "certificate-import-password";
  await execute("openssl", [
    "pkcs12",
    "-export",
    "-inkey",
    join(directory, "key.pem"),
    "-in",
    join(directory, "certificate.pem"),
    "-out",
    certificate,
    "-keypbe",
    "PBE-SHA1-3DES",
    "-certpbe",
    "PBE-SHA1-3DES",
    "-macalg",
    "sha1",
    "-passout",
    `pass:${password}`,
  ]);

  const { keychainFile } = await createKeychain({
    tmpDir: temporaryFiles,
    cscLink: certificate,
    cscKeyPassword: password,
    currentDir: directory,
  });
  const { stdout: importedCertificate } = await execute("/usr/bin/security", [
    "find-certificate",
    "-c",
    "Rebase signing test",
    "-p",
    keychainFile,
  ]);
  assert.match(importedCertificate, /BEGIN CERTIFICATE/);
});
