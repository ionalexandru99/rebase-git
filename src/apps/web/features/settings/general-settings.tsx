import { type JSX, useState } from "react";
import {
  type DesktopUpdateSnapshot,
  type DesktopUpdates,
  type ReleaseChannel,
  releaseChannels as releaseChannelValues,
} from "#contracts/desktop-updates/desktop-updates.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "#web/components/ui/settings-layout.tsx";
import { SettingsSelect } from "#web/components/ui/settings-select.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import {
  type ErrorAction,
  useErrorToast,
} from "#web/features/notifications/notifications.tsx";
import {
  saveThemePreference,
  type ThemePreference,
  themePreferences,
  useThemePreference,
} from "#web/features/theme/theme.ts";

const releaseChannelLabels: Record<ReleaseChannel, string> = {
  nightly: "Nightly",
  stable: "Stable",
};
const releaseChannels = releaseChannelValues.map((value) => ({
  label: releaseChannelLabels[value],
  value,
}));

const themeLabels: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
const themeOptions = themePreferences.map((value) => ({
  label: themeLabels[value],
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
  const themePreference = useThemePreference();
  const [settingsPending, setSettingsPending] = useState(false);
  const desktopReady =
    desktopUpdates !== undefined &&
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
    }
    setSettingsPending(false);
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
    <SettingsPage title="General">
      <SettingsSection title="Appearance">
        <SettingsRow title="Theme">
          <SettingsSelect
            label="Theme"
            onValueChange={saveThemePreference}
            options={themeOptions}
            value={themePreference}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Rebase">
        <SettingsRow
          description={
            desktopUpdates === undefined
              ? undefined
              : updateDescription(snapshot, desktopReady, updateLoadError)
          }
          descriptionId="updates-description"
          liveDescription
          title="Version"
          value={productVersion}
        >
          {desktopUpdates === undefined ? undefined : (
            <>
              <Button
                aria-describedby="updates-description"
                disabled={!canCheck}
                onClick={() => {
                  void runAction(
                    () => desktopUpdates.checkForUpdates(),
                    "checkUpdates",
                  );
                }}
                size="sm"
                variant="outline"
              >
                {checkButtonLabel(snapshot)}
              </Button>
              {snapshot.status._tag === "Ready" ? (
                <Button
                  aria-describedby="updates-description"
                  disabled={!canInstall}
                  onClick={() => {
                    void runAction(
                      () => desktopUpdates.installUpdate(),
                      "installUpdate",
                    );
                  }}
                  size="sm"
                >
                  Update now
                </Button>
              ) : null}
            </>
          )}
        </SettingsRow>
        {desktopUpdates === undefined ? null : (
          <>
            <SettingsRow title="Release channel">
              <SettingsSelect
                disabled={!desktopReady || settingsPending || channelLocked}
                label="Release channel"
                onValueChange={(value) => {
                  void changeSetting(() =>
                    desktopUpdates.selectReleaseChannel(value),
                  );
                }}
                options={releaseChannels}
                value={snapshot.settings.releaseChannel}
              />
            </SettingsRow>
            <SettingsRow title="Check automatically">
              <Switch
                aria-label="Check automatically"
                checked={snapshot.settings.checkAutomatically}
                disabled={!desktopReady || settingsPending}
                onCheckedChange={(checked) => {
                  void changeSetting(() =>
                    desktopUpdates.setCheckAutomatically(checked),
                  );
                }}
              />
            </SettingsRow>
          </>
        )}
      </SettingsSection>
    </SettingsPage>
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
  desktopReady: boolean,
  loadError: string | undefined,
) {
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
