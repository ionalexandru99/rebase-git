import { describe, expect, it } from "vite-plus/test";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { catalogEntry } from "#tests-support/fixtures.ts";
import {
  initialNavigation,
  type Navigation,
  reduceNavigation,
} from "#web/app/shell/use-navigation.ts";

const payments = catalogEntry({ id: "payments", name: "payments" });
const worker = catalogEntry({ id: "worker", name: "worker" });

describe("shell navigation", () => {
  it("opens a repository in place of its settings", () => {
    const settings = reduceNavigation(initialNavigation(), {
      type: "show-repository-settings",
      repositoryId: payments.id,
    });

    const opened = reduceNavigation(settings, {
      type: "open-repository",
      repository: payments,
    });

    expect(opened).toMatchObject({
      openRepositories: [payments],
      repositorySettingsId: undefined,
      selectedRepositoryId: payments.id,
      workspaceView: "repository",
    });
  });

  it("selects an open repository without adding it again", () => {
    const state = openAll(payments, worker);

    const selected = reduceNavigation(state, {
      type: "open-repository",
      repository: payments,
    });

    expect(selected).toMatchObject({
      openRepositories: [payments, worker],
      selectedRepositoryId: payments.id,
    });
  });

  it("shows Open project without clearing the selected repository", () => {
    const state = openAll(payments);

    const openProject = reduceNavigation(state, { type: "show-open-project" });

    expect(openProject).toMatchObject({
      openRepositories: [payments],
      selectedRepositoryId: payments.id,
      workspaceView: "open-project",
    });
  });

  it("closes the settings of a repository that leaves the sidebar", () => {
    const settings = reduceNavigation(openAll(payments), {
      type: "show-repository-settings",
      repositoryId: payments.id,
    });

    const closed = reduceNavigation(settings, {
      type: "close-repository",
      repositoryId: payments.id,
    });

    expect(closed).toMatchObject({
      openRepositories: [],
      repositorySettingsId: undefined,
      selectedRepositoryId: undefined,
      workspaceView: "open-project",
    });
  });

  it("closes another repository without clearing the selection", () => {
    const closed = reduceNavigation(openAll(worker, payments), {
      type: "close-repository",
      repositoryId: worker.id,
    });

    expect(closed).toMatchObject({
      openRepositories: [payments],
      selectedRepositoryId: payments.id,
      workspaceView: "repository",
    });
  });
});

function openAll(
  ...repositories: readonly RepositoryCatalogEntry[]
): Navigation {
  return repositories.reduce(
    (navigation, repository) =>
      reduceNavigation(navigation, { type: "open-repository", repository }),
    initialNavigation(),
  );
}
