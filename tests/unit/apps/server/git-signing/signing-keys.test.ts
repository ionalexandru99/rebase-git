import { Effect } from "effect";
import { expect, it } from "vite-plus/test";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { listSigningKeys } from "#server/features/git-signing/signing-keys.ts";

const agentKeys = [
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAgent ada@laptop",
  "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCnocomment",
  "The agent has no identities.",
].join("\n");

const gpgKeys = [
  "sec:u:255:22:AD5EB245D759C8BC:1792096565:::u:::scSC:::+::ed25519:::0:",
  "fpr:::::::::EE7C6B972342375965730C86AD5EB245D759C8BC:",
  "uid:u::::1792096565::262C::Ada <ada@example.com>::::::::::0:",
  "ssb:u:255:18:0E4CB7A4C2B1F2D3:1792096565::::::e:::+::cv25519::",
  "fpr:::::::::11112222333344445555666677778888C2B1F2D3:",
  "sec:e:255:22:1111111111111111:1600000000:1700000000::u:::scSC:::+::ed25519:::0:",
  "fpr:::::::::AAAABBBBCCCCDDDDEEEEFFFF1111111111111111:",
  "uid:e::::1600000000::AAAA::Old <old@example.com>::::::::::0:",
  "sec:u:255:22:2222222222222222:1792096565:::u:::eE:::+::ed25519:::0:",
  "fpr:::::::::AAAABBBBCCCCDDDDEEEEFFFF2222222222222222:",
].join("\n");

it("lists agent keys and GPG keys that can sign, skipping expired keys, subkeys and encryption-only keys", async () => {
  const git: GitCommandRunner = {
    run: ({ arguments: args }) =>
      Effect.succeed({
        exitCode: 0,
        stderr: "",
        stdout: args.includes("--type=path")
          ? "/nonexistent/rebase/.ssh"
          : args.some((arg) => arg.includes("ssh-add"))
            ? agentKeys
            : gpgKeys,
      }),
    stream: () => {
      throw new Error("Key listing never streams.");
    },
  };

  const keys = await Effect.runPromise(listSigningKeys(git, "/home/ada"));

  expect(keys).toEqual([
    {
      format: "ssh",
      key: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAgent",
      label: "ada@laptop",
    },
    {
      format: "ssh",
      key: "key::ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCnocomment",
      label: "…ocomment",
    },
    {
      format: "openpgp",
      key: "EE7C6B972342375965730C86AD5EB245D759C8BC",
      label: "D759C8BC · ada@example.com",
    },
  ]);
});
