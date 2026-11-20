// Start-up update check: asks GitHub whether a newer release exists and, if the
// player agrees, downloads it, installs it and restarts the app.
//
// Every failure (offline, no release published yet) is only logged on the
// loading screen. Updating is optional and must never stop the app opening.

import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isDesktopApp } from "./catalog";
import { downloadText, stageFraction, type LoadingScreen } from "./loadingScreen";

/** How long to wait for GitHub before giving up and starting the app. */
const CHECK_TIMEOUT_MILLISECONDS = 8000;

/** Checks for an update and offers it. Returns when the app should carry on starting. */
export async function checkForUpdate(screen: LoadingScreen): Promise<void> {
  if (!isDesktopApp()) return; // a plain browser has nothing to update
  screen.say("Checking for updates...");

  try {
    const update = await check({ timeout: CHECK_TIMEOUT_MILLISECONDS });
    if (update === null) {
      screen.say("You have the latest version.");
      return;
    }

    screen.say(`Version ${update.version} is available (you have ${update.currentVersion}).`);
    const wantsUpdate = await screen.askChoice("Update now", "Not now");
    if (!wantsUpdate) {
      screen.say("Skipping the update for now.");
      return;
    }

    let total = 0;
    let done = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
      } else if (event.event === "Progress") {
        done += event.data.chunkLength;
        screen.progress(downloadText(done, total), stageFraction(0, 1, done, total));
      } else {
        screen.say("Download finished. Installing...");
      }
    });
    screen.say("Restarting...");
    await relaunch();
  } catch (error) {
    // Typical when offline, or before the first release with an update file exists.
    screen.say(`Could not check for updates (${error}). Continuing.`);
    screen.progress("Starting...", 0);
  }
}
