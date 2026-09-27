import {
  EnvironmentAuthorizationHttpApi,
  EnvironmentFilesystemHttpApi,
  RepositoryCatalogHttpApi,
} from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import { openTestServer } from "#tests-support/server";

describe("Environment HTTP router", () => {
  it("answers unknown paths and unsupported methods from the route table", async () => {
    const { origin } = await openTestServer();
    expect((await fetch(`${origin}/api/unknown`)).status).toBe(404);
    const wrongMethod = await fetch(
      `${origin}${RepositoryCatalogHttpApi.list.path}`,
      { method: "POST", headers: { origin } },
    );
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get("allow")).toBe("GET");
  });

  it("rejects unpaired credentials and stray bodies before running the handler", async () => {
    const { origin, owner } = await openTestServer();
    const denied = await fetch(
      `${origin}${RepositoryCatalogHttpApi.list.path}`,
      { headers: { authorization: "Bearer unpaired" } },
    );
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ _tag: "InvalidGrant" });
    const stray = await fetch(
      `${origin}${EnvironmentAuthorizationHttpApi.mintWebSocketTicket.path}`,
      {
        body: " ",
        headers: { authorization: `Bearer ${owner.value}`, origin },
        method: "POST",
      },
    );
    expect(stray.status).toBe(400);
    expect(await stray.json()).toEqual({ _tag: "InvalidMessage" });
  });

  it("answers Ok and Rejected at 200 while authorization failures keep their status", async () => {
    const { home, origin, owner } = await openTestServer();
    const listed = await postJson(origin, owner.value, {
      path: home,
      includeHidden: true,
    });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      _tag: "Ok",
      value: { path: home },
    });
    const missing = await postJson(origin, owner.value, {
      path: `${home}/missing`,
    });
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({
      _tag: "Rejected",
      failure: { _tag: "EnvironmentDirectoryRejected", reason: "NotFound" },
    });
    const denied = await postJson(origin, "unpaired", { path: home });
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ _tag: "InvalidGrant" });
    const malformed = await postJson(origin, owner.value, {
      path: home,
      extra: 1,
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ _tag: "InvalidMessage" });
  });
});

function postJson(origin: string, credential: string, body: unknown) {
  return fetch(`${origin}${EnvironmentFilesystemHttpApi.listDirectory.path}`, {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${credential}`,
      "content-type": "application/json",
      origin,
    },
    method: "POST",
  });
}
