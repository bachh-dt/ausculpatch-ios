# AusculPatch for iPhone

An iPhone app for the AusculPatch, built with Expo (React Native). It does what the desktop clinical monitor does, plus the developer controls you need in the field:

The Monitor tab shows heart rate, breathing rate, skin temperature and battery, with live heart-sound, ECG (mV) and breathing traces that use the same filters as `apps/clinical.py`. The Recording tab sets the measurement schedule (continuous or bursts), starts, stops and erases a recording on the patch, and downloads it to the phone as CSV. The Device tab has the protocol version, reset reason, sampling rates, ADS1220 gain and offset, and the flash self-test. Files lists every download and phone recording with a Share button (AirDrop, email, Files, OneDrive), and Log shows the patch's status lines.

The CSV is the same format the desktop tools write (`Timestamp(us),Device_Index,DataType,Value..Value6,Epoch_us`), so files from the phone open in the workbench.

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
| `src/live/clinical.ts` | `ClinicalTraces` and `_refresh_vitals` in `apps/clinical.py` |
| `src/ble/session.ts` | `ble.py` and `ui/session.py` |

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

## Using it

1. Open the app, tap Scan on the Monitor tab, then tap the patch.
2. The traces start within a second or two. Heart rate needs about 2 s of ECG and breathing rate about 12 s of signal; until then the tiles show a dash.
3. To download a recording, go to Recording and tap Download to phone. Keep the phone near the patch. The screen can lock; the app has Bluetooth background mode. If the link drops, tap Resume download and it asks the patch for the first page it is missing.
4. Share the CSV from the download card or the Files tab. The raw `.bin` image is kept as well, in case you want to decode it again on the desktop.

The patch schedule on this app always saves bursts to the patch's memory, as the desktop clinical app does, because a live-only schedule loses data once the phone leaves the room.

## Things that are untested

The protocol, download and signal code is tested against the Python host. The Bluetooth layer (`react-native-ble-plx`) and the screens have only been compiled and bundled; they have not run on an iPhone yet. Check these on the first build:

- Connection and live streaming at the default rates (acoustic 2000 Hz). iOS picks the MTU itself; the Device tab shows what it got.
- A full-size flash download. Download speed depends on the connection interval iOS accepts for the 7.5 ms the firmware requests.
- Reconnection after walking out of range.
