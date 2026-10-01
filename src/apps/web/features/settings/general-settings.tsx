import { Select } from "@base-ui/react/select";
import { IconChevronDown } from "@tabler/icons-react";
import { type JSX, useState } from "react";
import {
  type DesktopUpdateSnapshot,
  type DesktopUpdates,
  type ReleaseChannel,
  releaseChannels as releaseChannelValues,
} from "#contracts/desktop-updates/desktop-updates.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { SettingsRow as SettingRow } from "#web/components/ui/settings-layout.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import {
  type ErrorAction,
  useErrorToast,
} from "#web/features/notifications/notifications.tsx";

const releaseChannelLabels: Record<ReleaseChannel, string> = {
  nightly: "Nightly",
  stable: "Stable",
};
const releaseChannels = releaseChannelValues.map((value) => ({
  label: releaseChannelLabels[value],
  value,
}));

const unavailableSnapshot: DesktopUpdateSnapshot = {
  settings: {
    checkAutomatically: false,
    releaseChannel: "stable",
  },
  status: { _tag: "Unavailable" },
};

export function GeneralSettings({
  desktopUpdates,
  productVersion,
  updateLoadError,
  updateSnapshot,
}: {
  readonly desktopUpdates: DesktopUpdates | undefined;
  readonly productVersion: string;
  readonly updateLoadError: string | undefined;
  readonly updateSnapshot: DesktopUpdateSnapshot | undefined;
}): JSX.Element {
  const snapshot = updateSnapshot ?? unavailableSnapshot;
  const errorToast = useErrorToast();
  const [settingsPending, setSettingsPending] = useState(false);
  const desktopAvailable = desktopUpdates !== undefined;
  const desktopReady =
    desktopAvailable &&
    updateSnapshot !== undefined &&
    updateLoadError === undefined;
  const checking =
    snapshot.status._tag === "Checking" ||
    snapshot.status._tag === "Downloading";
  const channelLocked = checking || snapshot.status._tag === "Ready";
  const canCheck =
    desktopReady &&
    !settingsPending &&
    (snapshot.status._tag === "Idle" ||
      snapshot.status._tag === "UpToDate" ||
      snapshot.status._tag === "Error");
  const canInstall =
    desktopReady && !settingsPending && snapshot.status._tag === "Ready";

  const changeSetting = async (action: () => Promise<void>) => {
    setSettingsPending(true);
    try {
      await action();
    } catch {
      errorToast.show("saveUpdateSettings");
    } finally {
      setSettingsPending(false);
    }
  };

  const runAction = async (
    action: () => Promise<void>,
    failure: ErrorAction,
  ) => {
    try {
      await action();
    } catch {
      errorToast.show(failure);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-10 pb-16 sm:px-8 sm:pt-12">
      <h1 className="text-xl font-semibold tracking-tight">General</h1>
      <div className="mt-6 space-y-1">
        <SettingRow title="Version">
          <span className="shrink-0 text-sm text-muted-foreground">
            {productVersion}
          </span>
        </SettingRow>
        <SettingRow
          description={
            desktopReady ? "Stable follows full releases." : undefined
          }
          descriptionId="release-channel-description"
          title="Release channel"
        >
          <Select.Root
            disabled={!desktopReady || settingsPending || channelLocked}
            items={releaseChannels}
            onValueChange={(value) => {
              if (value !== null && desktopUpdates !== undefined) {
                void changeSetting(() =>
                  desktopUpdates.selectReleaseChannel(value),
                );
              }
            }}
            value={snapshot.settings.releaseChannel}
          >
            <Select.Trigger
              aria-describedby="release-channel-description"
              aria-label="Release channel"
              className="flex h-8 w-40 shrink-0 items-center justify-between rounded-md border border-input bg-input/30 px-3 text-sm text-foreground outline-none hover:bg-accent data-disabled:cursor-not-allowed data-disabled:opacity-45 data-pressed:bg-accent focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            >
              <Select.Value />
              <Select.Icon>
                <IconChevronDown
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner
                align="end"
                alignItemWithTrigger={false}
                className="z-50 outline-none"
                sideOffset={4}
              >
                <Select.Popup className="w-[var(--anchor-width)] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none">
                  <Select.List>
                    {releaseChannels.map((channel) => (
                      <Select.Item
                        className="flex h-8 cursor-default items-center rounded-sm px-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                        key={channel.value}
                        value={channel.value}
                      >
                        <Select.ItemText>{channel.label}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.List>
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
        </SettingRow>
        <SettingRow
          description={
            desktopReady
              ? "Check the selected channel when Rebase starts."
              : undefined
          }
          descriptionId="automatic-update-description"
          title="Check automatically"
        >
          <Switch
            aria-describedby="automatic-update-description"
            aria-label="Check automatically"
            checked={snapshot.settings.checkAutomatically}
            disabled={!desktopReady || settingsPending}
            onCheckedChange={(checked) => {
              if (desktopUpdates !== undefined) {
                void changeSetting(() =>
                  desktopUpdates.setCheckAutomatically(checked),
                );
              }
            }}
          />
        </SettingRow>
        <SettingRow
          description={updateDescription(
            snapshot,
            desktopAvailable,
            desktopReady,
            updateLoadError,
          )}
          descriptionId="updates-description"
          liveDescription
          title="Updates"
        >
          <div className="flex flex-wrap items-center gap-2 md:shrink-0">
            <Button
              aria-describedby="updates-description"
              disabled={!canCheck}
              onClick={() => {
                if (desktopUpdates !== undefined) {
                  void runAction(
                    () => desktopUpdates.checkForUpdates(),
                    "checkUpdates",
                  );
                }
              }}
              size="sm"
              variant="outline"
            >
              {checkButtonLabel(snapshot)}
            </Button>
            <Button
              aria-describedby="updates-description"
              disabled={!canInstall}
              onClick={() => {
                if (desktopUpdates !== undefined) {
                  void runAction(
                    () => desktopUpdates.installUpdate(),
                    "installUpdate",
                  );
                }
              }}
              size="sm"
            >
              Update now
            </Button>
          </div>
        </SettingRow>
      </div>
    </div>
  );
}

function checkButtonLabel(snapshot: DesktopUpdateSnapshot) {
  if (snapshot.status._tag === "Checking") return "Checking…";
  if (snapshot.status._tag === "Downloading") {
    return `Downloading ${snapshot.status.percent}%`;
  }
  if (
    snapshot.status._tag === "Ready" ||
    snapshot.status._tag === "UpToDate" ||
    snapshot.status._tag === "Error"
  ) {
    return "Check again";
  }
  return "Check for updates";
}

function updateDescription(
  snapshot: DesktopUpdateSnapshot,
  desktopAvailable: boolean,
  desktopReady: boolean,
  loadError: string | undefined,
) {
  if (!desktopAvailable) return "Updates are managed by the desktop app.";
  if (loadError !== undefined) return loadError;
  if (!desktopReady) return "";

  switch (snapshot.status._tag) {
    case "Checking":
      return "Checking the selected release channel.";
    case "Downloading":
      return `Downloading version ${snapshot.status.version}.`;
    case "Ready":
      return `Version ${snapshot.status.version} is ready to install.`;
    case "UpToDate":
      return "This is the latest version on the selected channel.";
    case "Error":
      return `The update check failed. ${snapshot.status.message}`;
    case "Unavailable":
      return "Updates are unavailable for this installation.";
    case "Idle":
      return "";
  }
}
