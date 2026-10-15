import { describe, expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import {
  type SignatureCheck,
  SignatureVerificationApi,
} from "#contracts/signature-verification/signature-verification.contract.ts";
import { fakeRequests, respond } from "#tests-support/fake-requests.ts";
import { commitInspection, repositoryScope } from "#tests-support/fixtures.ts";
import { render } from "#tests-support/render.tsx";
import { CommitMetadata } from "#web/features/commit-inspection/components/commit-metadata.tsx";
import { RepositoryScopeProvider } from "#web/platform/query/repository-scope.tsx";

const key = "SHA256:aFbW+AMOCtKlhfHTnE0UV4Ra0aQIWfa6u3japROpK2c";

describe("signature status", () => {
  it("shows the result as one glyph and explains it on hover and from the keyboard", async () => {
    const requests = fakeRequests(
      respond(
        SignatureVerificationApi.verify,
        (): SignatureCheck => ({
          _tag: "UnknownKey",
          reason: "NotAllowedSigner",
          signer: null,
          key,
        }),
      ),
    );
    const screen = await render(
      <RepositoryScopeProvider scope={repositoryScope()}>
        <CommitMetadata
          details={commitInspection({ message: "Sign releases" })}
        />
      </RepositoryScopeProvider>,
      { environment: { requests } },
    );
    const glyph = screen.getByRole("button", {
      name: "Signature: Unknown key",
    });
    const explanation = screen.getByText(
      "This key isn't in your allowed signers.",
    );

    await expect.element(glyph).toBeVisible();
    await userEvent.tab();
    await userEvent.tab();
    await expect.element(glyph).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(explanation).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(explanation).not.toBeInTheDocument();
    await glyph.hover();
    await expect.element(explanation).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: `Copy ${key}` }))
      .toHaveTextContent("SHA256:aFbW+AM…ROpK2c");
  });

  it("shows the commit straight away and nothing for unsigned commits or a check still running", async () => {
    let answerUnsigned = () => {};
    const unsignedAnswered = new Promise<void>((resolve) => {
      answerUnsigned = resolve;
    });
    const requests = fakeRequests(
      respond(
        SignatureVerificationApi.verify,
        async ({ object }): Promise<SignatureCheck> => {
          if (object === "a".repeat(40)) {
            answerUnsigned();
            return { _tag: "Unsigned" };
          }
          if (object === "b".repeat(40)) {
            await unsignedAnswered;
            return { _tag: "Verified", signer: "Ana Pop", key };
          }
          return new Promise(() => {});
        },
      ),
    );
    const screen = await render(
      <RepositoryScopeProvider scope={repositoryScope()}>
        {["a", "b", "c"].map((character) => (
          <CommitMetadata
            key={character}
            details={commitInspection({
              oid: character.repeat(40),
              message: `Commit ${character}`,
            })}
          />
        ))}
      </RepositoryScopeProvider>,
      { environment: { requests } },
    );

    await expect.element(screen.getByText("Commit c")).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Signature: Verified" }))
      .toBeVisible();
    expect(
      screen.getByRole("button", { name: /^Signature: / }).elements(),
    ).toHaveLength(1);
  });
});
