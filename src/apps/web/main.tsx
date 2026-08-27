import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { browserKeyboardShortcutHost } from "#web/features/keyboard-shortcuts/browser-keyboard-shortcut-host";
import { browserKeyboardShortcutStorage } from "#web/features/keyboard-shortcuts/browser-keyboard-shortcut-storage";
import { createKeyboardShortcutStore } from "#web/features/keyboard-shortcuts/keyboard-shortcut-store";
import { createBrowserLocalEnvironmentSession } from "#web/features/local-environment-session/browser-local-environment-session";
import { ApplicationShell } from "#web-ui/features/application-shell/application-shell";
import { KeyboardShortcutsProvider } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";
import "@rebase/web/styles.css";

const rootElement = document.getElementById("root");

if (!(rootElement instanceof HTMLElement)) {
  throw new Error('The web application requires an element with id "root".');
}

const productVersion = import.meta.env.REBASE_PRODUCT_VERSION;
const session = createBrowserLocalEnvironmentSession(productVersion);
session.start();
const keyboardShortcuts = {
  host: browserKeyboardShortcutHost(),
  store: createKeyboardShortcutStore(browserKeyboardShortcutStorage()),
};

createRoot(rootElement).render(
  <StrictMode>
    <KeyboardShortcutsProvider runtime={keyboardShortcuts}>
      <ApplicationShell
        desktopUpdates={window.rebaseHost?.updates}
        productVersion={productVersion}
        session={session}
      />
    </KeyboardShortcutsProvider>
  </StrictMode>,
);
