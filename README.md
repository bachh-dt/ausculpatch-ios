# AusculPatch for iPhone

An iPhone app for the AusculPatch, built with Expo (React Native).

The app has four tabs. Home shows heart rate, breathing rate, today's steps and live heart-sound and ECG traces, with a 5, 10 or 30 s window and a contact badge on each trace. Listen plays the heart sound live through the speaker or headphones and records it. Trends charts heart rate, breathing rate and steps by day, week or month. Sounds lists recordings with a player and a Share button. Settings covers the patch, fall alerts, the step goal and history export. Settings › Developer holds the technical controls: sampling rates, filter tuning, signal-quality thresholds, the log and the raw files.

Default filters are a 25 to 80 Hz order-4 band-pass for heart sound, a 1 to 40 Hz order-2 band-pass for ECG, and a 0.5 Hz order-2 low-pass for breathing (taken from the heart-sound envelope). All three can be changed under Developer › Filters, and the changes are kept.

What happens in the background:

- Every second the app scores the ECG and heart-sound quality (`src/dsp/quality.ts`). If either stays poor for 10 s, a sheet asks you to reattach the patch, and heart rate and breathing rate are hidden until the signals recover.
- Steps and falls come from the patch's accelerometer (`src/dsp/motion.ts`). A fall is a hard impact followed by 5 s of lying still at a clearly different angle. It raises a notification on the phone only. The sensitivity is set in Settings.
- Heart rate, breathing rate and steps are saved per minute in SQLite (`src/history`). Downloads from the patch are analysed the same way and added to Trends, using the patch's own clock.

The CSV files are the same format the desktop tools write (`Timestamp(us),Device_Index,DataType,Value..Value6,Epoch_us`), so files from the phone open in the workbench.

## How the code relates to the Python host

`src/protocol` and `src/dsp` are ports of `host/ausculpatch`:

| TypeScript | Python |
|---|---|
| `src/protocol/protocol.ts` | `protocol.py` |
| `src/protocol/decode.ts` | `decode.py` |
| `src/protocol/dump.ts` | `dump.py` |
| `src/protocol/flashlog.ts` | `flashlog.py` |
| `src/protocol/csv.ts` | `storage.py` (writing) |
| `src/live/buffers.ts` | `live.py` |
| `src/dsp/filters.ts`, `vitals.ts` | `filters.py`, `vitals.py` |
| `src/live/clinical.ts` | `ClinicalTraces` and `_refresh_vitals` in `apps/clinical.py`, with filters from Settings |
| `src/ble/session.ts` | `ble.py` and `ui/session.py` |

Signal quality, steps, falls, history, audio and the download analysis (`src/analysis/offline.ts`) are new to the phone and have their own tests with synthetic signals (`__tests__/dsp.test.ts`, `history.test.ts`, `audio.test.ts`, `offline.test.ts`). The parity tests still check the port against the desktop's 20 to 100 Hz and 0.1 to 40 Hz filters, which `filters.ts` keeps as `HOST_*` constants.

One deliberate difference: the Python assembler holds every dump chunk in memory. A full recording is about 134 MB, so the phone writes each chunk straight to a `.bin` file at its offset and keeps only the bookkeeping. The gap, CRC and resume rules are unchanged.

`__tests__/parity.test.ts` checks the port against the Python code. `scripts/make_vectors.py` runs the real `host/ausculpatch` modules (and scipy) to produce `__tests__/vectors.json`, and Jest checks that the TypeScript gives the same answers: byte-identical CSV from v2 and legacy flash images, the same dump gaps, resume page and integrity report, the same log parsing and command bytes, and filter outputs, peak picks and vital-sign estimates that match scipy. If you change the protocol, regenerate the vectors and run the tests:

```bash
npm run vectors   # needs Python with numpy and scipy, run from ios-app/
npm test
```

## Paid build (EAS and the Apple Developer Program)

The app is compiled on Expo's Macs in the cloud (EAS Build) and installed on your iPhone from a link. Nothing needs to be installed on your laptop: the commands below run in a GitHub Codespace, which is a Linux terminal in your browser.

What you need:

- An Apple Developer Program membership (US$99 a year), either your own or a seat on a UNSW or lab team. Apple only lets you install your own app on an iPhone from a cloud build when it is signed with a paid membership.
- A free Expo account (expo.dev).
- A free GitHub account.

### One-time setup

1. On github.com, create a new private repository, for example `ausculpatch-ios`.
2. Upload the contents of this folder to it (Add file, Upload files, and drag in everything except `node_modules`). Or, if you put this folder inside the firmware repository, push that repository instead.
3. In the repository, click Code, Codespaces, Create codespace. A VS Code window opens in the browser with a terminal at the bottom.
4. In that terminal (add `cd ios-app` first if the app is in a subfolder):

   ```bash
   npm ci
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```

   `init` links the project to your Expo account and writes its project ID into `app.json`. Commit that change.

5. Register your iPhone so the build can be installed on it:

   ```bash
   npx eas-cli@latest device:create
   ```

   Choose "Website", open the link or QR code it prints on the iPhone in Safari, and install the profile it offers (Settings, Profile Downloaded, Install).

6. Change the bundle identifier in `app.json` (`ios.bundleIdentifier`) if your Apple team cannot use `au.edu.unsw.ausculpatch`. Any reverse-domain name you control works.

### Each build

```bash
npx eas-cli@latest build --platform ios --profile preview
```

The first time, it asks you to sign in to your Apple account and offers to create the signing certificate and provisioning profile. Say yes to each. The build then runs on Expo's servers (10 to 20 minutes; on the free plan the queue can add more) and prints a link and QR code. Open it on the iPhone and tap Install.

On iOS 16 or later, the first install also needs Developer Mode: Settings, Privacy & Security, Developer Mode, turn it on and restart.

Expo's free plan gives up to 15 iOS builds a month, which is plenty if you test logic changes with `npm test` before building.

If you register another iPhone later, run `device:create` again and then rebuild, because an ad hoc build only installs on devices registered before it was built.

## Free build (GitHub Actions and Sideloadly)

This route costs nothing. A Mac on GitHub builds an unsigned app file (`AusculPatch-unsigned.ipa`), and Sideloadly on your Windows laptop signs it with your ordinary Apple ID and copies it to the iPhone over USB. The catch is that Apple lets a free Apple ID's apps run for only 7 days, so you repeat the Sideloadly step once a week. Recordings stay on the phone as long as you reinstall over the top and never delete the app.

The workflow is in `workflow/ios-unsigned.yml` in this folder and has to be placed at `.github/workflows/ios-unsigned.yml` in the GitHub repository. It runs the parity tests, generates the iOS project, builds it with Xcode and uploads the `.ipa`.

### Get the .ipa

1. Create a free GitHub account and a new repository, for example `ausculpatch-ios`.
2. Upload the contents of this folder to it (Add file, Upload files, then drag in everything in `ios-app`, leaving out `node_modules` if it exists). Upload the folder's contents, not the folder itself, so that `package.json` sits at the top of the repository.
   Then add the workflow: click Add file, Create new file, type `.github/workflows/ios-unsigned.yml` as the name (the slashes create the folders), paste in the contents of `workflow/ios-unsigned.yml` from this folder, and click Commit changes. GitHub only runs workflows from `.github/workflows`, which is why this step is separate.
3. Open the Actions tab. If GitHub asks, click to enable workflows. Pick "iOS unsigned build", then Run workflow. It also runs by itself every time you change code on the `main` branch.
4. The build takes about 15 to 25 minutes. When it shows a green tick, open the run and download `AusculPatch-unsigned-ipa` under Artifacts. It is a zip; extract `AusculPatch-unsigned.ipa` from it.

A private repository gets 2,000 free Actions minutes a month, but Mac minutes count ten times, so that is roughly eight to ten builds. A public repository has no limit. Builds you don't need can be skipped, because the same `.ipa` can be signed again every week without rebuilding.

### One-time setup on the laptop

Sideloadly needs Apple's device drivers, which come with iTunes and iCloud. Install the versions from Apple's website, not the Microsoft Store ones; if the Store versions are installed, uninstall them first.

1. Install iTunes for Windows (64-bit) from apple.com/itunes/download/win64.
2. Install iCloud for Windows from the link on sideloadly.io.
3. Install Sideloadly from sideloadly.io.
4. Plug the iPhone in, unlock it, open iTunes once and tap Trust on the phone.

### Install or renew the app

1. Plug the iPhone in and unlock it. Open Sideloadly.
2. Drag `AusculPatch-unsigned.ipa` onto it, check your iPhone is selected, type your Apple ID email and click Start. Enter the password and the two-factor code when asked. Your Apple ID goes to Apple only, but you can make a separate Apple ID just for this if you prefer.
3. The first time only, on the iPhone: Settings, General, VPN & Device Management, tap your Apple ID and choose Trust. Then Settings, Privacy & Security, Developer Mode, turn it on and restart.
4. Every 7 days, repeat steps 1 and 2 with the same `.ipa` and the same Apple ID. The app updates in place and keeps its files.

If Sideloadly reports that the bundle ID is unavailable, open Advanced options and let it change the bundle ID, or edit `ios.bundleIdentifier` in `app.json` and rebuild. A free Apple ID can have three sideloaded apps installed at once.

If you want the weekly renewal to happen without plugging in, AltStore (altstore.io) can re-sign over Wi-Fi while its AltServer runs on the laptop. It uses the same iTunes and iCloud install and accepts the same `.ipa`.

## Why it no longer lags at high sampling rates

The first version filtered the signals inside the screen's render function and copied every sample of every trace on each redraw, about 2 MB of garbage a frame at 4 kHz. Now one timer in `src/live/engine.ts` does the filtering, steps, falls, audio and recording once per frame. Each trace asks its ring buffer for the minimum and maximum of every pixel column without copying (`ChannelBuffer.reduceColumns`) and draws one path with Skia on the GPU. Heart rate and breathing rate are worked out every 2 s, not every frame. The frame rate is 30 fps by default and can be set to 15 or 60 under Developer › Filters.

## Using it

1. Open the app and tap Connect patch on Home, then tap the patch in the list.
2. The traces start within a second or two. Heart rate needs about 2 s of clean ECG and breathing rate about 12 s of signal; until then the tiles say Measuring.
3. Tap Listen to hear the heart sound. The 25 to 80 Hz heart band is too low for the phone's speaker, so use headphones, or switch the listening band to "Wider, for speaker" (25 to 400 Hz).
4. Tap Record on Home or Listen. The recording saves an 8 kHz WAV of the heart sound plus a CSV of every sample, and appears under Sounds.
5. To download what the patch stored, go to Settings › Recording on the patch and tap Download to phone. Keep the phone near the patch. If the link drops, tap Resume download. When it finishes, the minutes it covers appear in Trends.
6. Share any recording from Sounds, or any raw file from Developer › Files.

The patch schedule on this app always saves bursts to the patch's memory, as the desktop clinical app does, because a live-only schedule loses data once the phone leaves the room.

## Things that are untested

The protocol, download, signal-processing, quality, motion, history and audio-buffer code is tested in Jest. Everything that needs an iPhone has only been type-checked and bundled. Check these on the first build:

- Connection and live streaming at the default rates (acoustic 2000 Hz), and whether the traces stay smooth at 4000 Hz.
- Live listening and WAV playback (`react-native-audio-api`), including how much delay the listening has.
- Whether the quality thresholds suit the real patch. Watch the scores under Developer › Filters while you press, lift and rub the patch, and adjust "Good above" if the reminder comes too early or too late.
- Step counts while walking and the fall detector, with a few controlled drops onto a cushion. The thresholds come from synthetic tests, not from patch data.
- Fall notifications on the lock screen (allow notifications when asked).
- A full-size flash download, and that its minutes show in Trends.
- Reconnection after walking out of range.
