This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

## Abracadabra status

What this repo is today:

- **Stack:** React Native **0.85.x**, React **19.2.3** (keep this **exact** patch in sync with the Hermes renderer bundled in RN or you’ll hit a version-mismatch runtime error). TypeScript. **[Gluestack UI](https://gluestack.io/ui)** (`@gluestack-ui/themed` + `@gluestack-ui/config`) drives layout with **forced dark** styling and neon-accent cyberpunk visuals in `App.tsx`.
- **BLE transfer:** The wearable sends **framed NOTIFY** packets on **`ADAB0003`** (magic **`0xADAB`** LE, **`pkt`** byte, reserved byte, payload):
  - **`RECORDING_PENDING` (`pkt = 4`):** right after an **accepted** double-tap — payload **`window_id` u16 LE**, **`proto_ver` u8**, reserved — so the app can show **armed / recording** before onboard capture finishes.
  - **`META` (`pkt = 1`):** after capture — **`window_id`**, **`sample_count`**, **`total_bytes`**, **IEEE CRC-32** over the full packed buffer (see **`bleRecordingProtocol.ts`**).
  - **`CHUNK` (`pkt = 2`):** iOS-first fast path — **`window_id` u16 + byte `offset` u32 + `data_len` u16 + packed bytes**. Firmware caps notify values at **182 bytes** for the common iOS **ATT_MTU 185** case and paces chunks with **`kBleNotifyChunkPaceMs`**; the app writes every chunk into the exact byte range declared by **META**.
  - **`COMMIT` (`pkt = 3`):** transfer-end marker — **`window_id`**, **`total_bytes`**, **CRC-32**, protocol version. The app only accepts the recording when every byte is present and **CRC + sample decode** pass.
  This changes **transport only**: sample rate, raw `int16` axes, `t_ms`, and model input quality remain identical. The old **`ADAB0004`** / **`ADAB0005`** GATT pull path remains in protocol code as a compatibility/diagnostic fallback. The iPhone app path prefers notify chunks to avoid repeated write-offset + read-slice round trips, then automatically recovers with GATT pull if **COMMIT** arrives before every notify byte was received.
- **Link UI:** **`BleLinkStatusBadge.tsx`** shows a compact capsule (**Gluestack Badge**-style): animated orb (≤30% width) + status label (**Connecting**, **Connected**, **Linked**, **Recording**, **Processing**, **Retry**, **Disconnected**). Tap the orb for a short detail **toast** (session/RSSI/GATT copy). After notify chunks complete, the badge shows **Processing** while **`finalizeRecordingPayload`** verifies CRC and unpacks samples before the timeline appears.
- **Recording UI:** Verified recordings show a **Recording timeline** card with **[Gluestack Tabs](https://gluestack.io/ui)** switching SVG charts in **`RecordingTimelineCharts.tsx`**: **ACC RAW**, **GYRO RAW**, **ACC MAG** (‖a‖), **GYRO MAG** (‖ω‖), **ALL MAG** (‖a‖ and ‖ω‖ each min–max normalized to 0…1 for shape comparison), **ALL RAW** (six raw axes each min–max normalized the same way). A **window time** strip shows **`t_ms`** range from the samples (nominal **index × 5 ms** on the MCU—see firmware README); it is **not** BLE transfer duration. **Crop timeline** sliders use **`@react-native-community/slider`** (run **`bundle exec pod install`** under **`ios/`** after install). Moving **start** / **end** updates the chart overlay live; the staged crop commits to Training when you **release** the slider (`onSlidingComplete`), and a new recording auto-stages the full window once.
- **Gesture ML flow:** The app’s decoded recording shape is the source of truth for **`abracadabra_gesture_processing`**. A recording is **`{ windowId, samples: [{ t_ms, ax, ay, az, gx, gy, gz }] }`**. Cropped timeline windows can be labeled as **`tap`**, **`double_tap`**, **`still`** / **silence**, or **`wrist_rotation`** and uploaded as JSON training samples. The app can refresh server/model status, train the Random Forest model, classify a selected crop, and analyze a full 3–4 s recording. Full-recording analyze returns **raw** `segments` (overlapping sliding-window hits—e.g. separate `tap` windows inside a `double_tap`) plus **`resolved_segments`** and **`sequence`** after server precedence (`wrist_rotation` > `double_tap` > `tap` > `still`). **`gestureApi.analyzeRecording`** normalizes every response; **`segmentResolve.ts`** mirrors the same rules client-side if an older server omits those fields. The UI shows resolved segments for the password line and segment list; raw count is labeled **raw** for debugging. Gestures below **50%** confidence are excluded from resolve and the password sequence (`min_confidence: 0.5` on analyze). Password save/match uses **`analysisToPasswordSequence()`** (never raw segment order). `t_ms` / `windowId` are metadata for ordering, timing, tracing, and UI mapping—not model features.
- **Native integration:** Safe area uses **`react-native-safe-area-context`** (`useSafeAreaInsets`), not deprecated RN `SafeAreaView`. **Skia** is used for the **NeonBackdrop** gradient (main hero orb was replaced by the link badge).
- **Install / Metro:** **`.npmrc`** sets **`legacy-peer-deps=true`** so Gluestack’s peer graph resolves cleanly. **`metro.config.js`** aliases **`react-dom`** to **`rn-shims/react-dom`** because Gluestack pulls **react-aria**, which expects **`flushSync`** from `react-dom` (not shipped on React Native).

This repo is set up for **iPhone** deployment; the React Native template still includes an `android/` folder.

## App architecture — The Vault (game), Training, Spellbook

> **Node:** every Node/npm/npx command in this repo must run under **Node 26**: `source ~/.nvm/nvm.sh && nvm use 26 && <cmd>`. A bare shell has no `node`/`npm` on PATH. This is also captured as an always-on rule in `.cursor/rules/nodejs-nvm.mdc`.

The app is a **react-navigation** bottom-tab shell with three screens. The wearable link is **inbound-only** (the phone never sends commands to the wearable), so every real-world effect runs on the phone.

### Navigation shell (`App.tsx`)

`App.tsx` composes the providers and the tab navigator:

```
GestureHandlerRootView
└─ SafeAreaProvider
   └─ GluestackUIProvider (dark)
      └─ NavigationContainer (dark NAV_THEME, #020617)
         └─ Tab.Navigator (initialRoute "Vault", custom NeonTabBar, headers hidden, lazy: false)
            ├─ Vault       → src/screens/VaultScreen.tsx   (main game)
            ├─ Training    → AbracadabraScreen (in App.tsx) (BLE owner + ML training)
            └─ Spellbook   → src/screens/SpellbookScreen.tsx
```

- **`lazy: false` is deliberate.** The **Training** screen (`AbracadabraScreen`) owns the BLE radio, the scan/connect/reconnect effects, the NOTIFY transfer assembler, and all ML/training calls — exactly as before. Mounting it eagerly keeps the radio connected and recordings flowing **even while the Vault tab is on top**.
- **Custom tab bar:** `src/navigation/NeonTabBar.tsx` renders neon labels with a glowing active indicator (no header chrome). Tab items use the shared press feedback wrappers in **`src/ui/`** (scale + haptic).

### Shared state (zustand) — `src/store/`

The cross-screen state machine lives in zustand; the imperative BLE plumbing stays in the proven `AbracadabraScreen` component, which **publishes** into the store.

- **`sessionStore.ts`** — live session facts + recording + game outcome.
  - `AbracadabraScreen` publishes raw `SessionFacts` (bleState, scan outcome, conn phase, reconnect attempt, recv/arming/processing flags) and the latest `DecodedRecording` (+ a `recordingNonce` that increments on each new recording).
  - `selectVaultStatus(state)` derives the HUD status: `vaultResult` overlay → `analyzing` → live link status.
- **`selectors.ts`** — `computeLinkStatus(facts)` is the **status state machine ladder ported out of `AbracadabraScreen`'s `useMemo`** into a pure, testable function shared by every screen. `VaultStatus = LinkBadgeStatus | 'analyzing' | 'unlocked' | 'denied'`.
- **`spellbookStore.ts`** — persisted spell list (CRUD + enable toggle). Backed by **MMKV v4** (`createMMKV`, via `react-native-nitro-modules`) through `zustand/middleware` `persist`. If the native module is not yet linked, it **degrades gracefully to in-memory** so the JS bundle still runs (spells just won't survive a restart until `pod install`).
- **`spell.ts`** — `Spell` + `UnlockAction` types and pure helpers (`matchSpell`, `sequencesMatch`, `formatSequence`, `describeAction`).

### The Vault game — `src/screens/VaultScreen.tsx` + `src/game/`

The Vault is the main screen: a large **Skia reactor HUD** (`src/game/VaultHud.tsx`) whose color, spin, and pulse react to `selectVaultStatus`. It self-animates with `requestAnimationFrame` (same approach as `NeonBackdrop`; no Reanimated needed for the HUD).

**Performance:** Training stays mounted (`lazy: false`) for BLE, but each tab’s `NeonBackdrop` / `VaultHud` only runs its animation loop while that tab is **focused** (`useIsFocused` + `active` prop). On Vault, the backdrop targets ~24 fps and the HUD ~40 fps so the moving ring dot does not compete with a second full-screen Skia loop from Training.

During NOTIFY receive, chunk bytes update a **ref** only; `recvReceiving` (published to Vault via zustand) flips on transfer start/end. Training’s byte counter in the link badge toast is throttled (~200 ms / 1% steps). Vault does not re-render per chunk. The NOTIFY stall watchdog reschedules at most every ~500 ms (not on every chunk). **`RecordingTimelineCharts`** mount only while the Training tab is focused. Sequential NOTIFY chunks use a fast contiguous receive path in **`bleRecordingProtocol.ts`**.

Game loop (only while the Vault tab is **focused**, via `useIsFocused`):

1. A new recording arrives from the wearable → `recordingNonce` bumps.
2. The Vault calls `gestureApi.analyzeRecording({ ..., include_still: true, min_confidence: 0.5 })` and builds the sequence with `analysisToPasswordSequence()` (server-resolved precedence; **<50%** gestures excluded).
3. `matchSpell(spells, detected)` looks for the first **enabled** spell whose sequence matches exactly.
   - **Match → `unlocked`:** runs `executeAction(spell.action)`, success haptic, shows the spell name.
   - **No match → `denied`:** error haptic, shows the detected sequence.
4. The result holds for ~6 s then returns to live status.

Manually casting from the Vault and tapping **Bind this gesture to a spell** navigates to the Spellbook with the detected sequence prefilled.

> Training-initiated analysis (the **Analyze full recording** button on the Training tab) is fully separate and **never** fires real-world actions — only the focused Vault tab judges and executes.

### Real-world actions — `src/actions/executeAction.ts`

Because BLE is inbound-only, a matched spell triggers a **phone-side** `UnlockAction`:

- **`open_url`** — `Linking.openURL` (deep links / websites, e.g. YouTube).
- **`sms`** — opens the iOS Messages composer (`sms:`); iOS requires the user to tap send.
- **`http`** — `fetch` GET/POST to a webhook (Home Assistant, IFTTT, smart locks/lights) — the universal "do something physical" action.
- **`notify`** — app-side message surfaced in the HUD.

### Spellbook — `src/screens/SpellbookScreen.tsx`

Create / enable / delete spells. A new spell binds the **gesture sequence cast in the Vault** to one of the action types above. Persisted via the MMKV-backed spellbook store.

### Haptics — `src/game/haptics.ts`

Thin guarded wrapper over `react-native-haptic-feedback` (iOS Taptic Engine). A missing native module no-ops instead of crashing.

### UI press feedback — `src/ui/`

Gluestack **`Button`** / **`Pressable`** do not show a clear pressed state on device, so interactive controls use thin wrappers:

- **`NeonButton`** — drop-in for Gluestack `Button`: Reanimated scale (~0.96) + opacity dip while pressed, spring back on release, light **`select`** haptic when enabled.
- **`NeonPressable`** — React Native `Pressable` with the same animation (tab bar, spellbook chips, link-badge orb tap).

Used across **Training** (`App.tsx`), **Vault**, **Spellbook**, timeline charts, and **`BleLinkStatusBadge`**.

### Native setup for the new dependencies

After pulling these changes, install pods and rebuild (the JS bundle is verified, but these are **native** modules that must be linked):

```
source ~/.nvm/nvm.sh && nvm use 26
npm install
cd ios && bundle exec pod install && cd ..
npx react-native run-ios --device   # or build from Xcode
```

New native modules: `react-native-screens`, `react-native-gesture-handler`, `react-native-reanimated` (+ `react-native-worklets`), `react-native-mmkv` (+ `react-native-nitro-modules`), `react-native-haptic-feedback`, `lottie-react-native`.

- **Reanimated v4** requires the Worklets Babel plugin — `babel.config.js` lists **`react-native-worklets/plugin` LAST**. Gesture Handler is imported first in **`index.js`** (`import 'react-native-gesture-handler'`). Reanimated v4 expects the **New Architecture** (default on RN 0.85).
- **`open_url` / `sms` deep links:** if iOS blocks a scheme, add it to `LSApplicationQueriesSchemes` in `Info.plist`.

> **Why the BLE logic was not split into a standalone hook (yet):** the proven ~1.6k-line BLE/recording component (CRC, NOTIFY assembler, fallback pull, reconnect) was kept intact and now simply **publishes to the store**, rather than being blind-retyped into a hook that couldn't be verified on-device here. A pure `useBleSession` extraction is a safe, mechanical follow-up once it can be exercised on hardware.

## Bluetooth (BLE)

This app uses [**react-native-ble-plx**](https://github.com/dotintent/react-native-ble-plx) to scan, **connect**, discover GATT, and **monitor** **`ADAB0003`** for framed **RECORDING_PENDING** + **META** + **CHUNK** + **COMMIT** packets. The primary device target is **iPhone**; the Android folder remains from the React Native template.

- **iOS:** `ios/AbracadabraRnApp/Info.plist` includes `NSBluetoothAlwaysUsageDescription` and `NSBluetoothPeripheralUsageDescription`. After changing native deps: `cd ios && bundle exec pod install`.
- **Flow:** Auto-scan for **`XA_Abracadabra`** → connect → discover → subscribe to **`ADAB0003-…`** on **`ADAB0001-…`**. On **RECORDING_PENDING**, arm UI / vibrate; on **META**, allocate the exact byte buffer; on **CHUNK**, fill by offset and update progress; on **COMMIT**, require complete byte coverage + CRC check + 14-byte LE decode before mounting charts. If notify chunks are incomplete, or chunk progress stalls and **COMMIT** never arrives, a watchdog triggers fallback pull of the same staged payload through **`ADAB0004`** / **`ADAB0005`** before rolling back. Failed transfers surface as rollback UI state.
- **Reconnect:** After an unexpected disconnect, the app waits ~**1.8 s** and reconnects automatically (same peripheral id), up to **15** tries, then shows **Link Lost** until **Scan Again**.
- **Why notify chunks on iOS:** CoreBluetooth does not give this app the same explicit MTU-control workflow as Android, and the previous pull model paid one write-with-response plus one read for each slice. Notify chunks reduce application round trips while staying inside the common iOS notify payload limit (**182 bytes**), using a small firmware-side pace delay, and preserving the exact same packed recording plus full-buffer CRC guarantee. This is a throughput optimization, not a sampling-quality change.
- **Debug logs:** During development, Metro logs **`[BleRx]`** for notify META / CHUNK / COMMIT progress, **`[BlePull]`** for fallback write-offset/read-slice progress, and **`[recording]`** for app-level transfer/finalize state. If the UI sticks on **Processing**, these tags show whether it is waiting on notify chunks, fallback GATT pull, or CRC/decode.

### Pairing with **abracadabra-platformio**

Firmware exposes `kBleDeviceName` (e.g. **XA_Abracadabra**), service **`ADAB0001-0000-1000-8000-00805F9B34FB`**, **RECORDING_PENDING** + **META** + **CHUNK** + **COMMIT** on **`ADAB0003-…`**, plus compatibility pull control/data characteristics **`ADAB0004-…`** / **`ADAB0005-…`** (see firmware README).

### Pairing with **abracadabra_gesture_processing**

The gesture server is a JSON-only FastAPI service intended to consume this app’s decoded samples directly:

- **Base URL:** `gestureApi.ts` currently points at `https://abracadabragestureprocessing-production.up.railway.app`.
- **Training crop:** `POST /api/training-samples` with `movement_type` + `window_id` + `samples`.
- **Training status:** `GET /api/training-samples` and `GET /api/model-status`.
- **Train model:** `POST /api/train` after collecting enough labeled crops.
- **Classify one crop:** `POST /api/recordings/classify`.
- **Analyze gesture password recording:** `POST /api/recordings/analyze` with a full 3–4 s recording (response includes `segments`, `resolved_segments`, `sequence`).

The **Training** crop workflow: adjust **start** / **end** sliders (overlay updates while dragging; staged crop commits on finger-up), pick a **training label**, **Upload crop**, then **Classify crop** after the model is trained. If classify returns a different movement than the selected label with **confidence > 60%**, the app switches the label to the prediction (server **`silence`** maps to UI **still**). Changing the crop clears pending upload/classify state. The full-recording analysis workflow sends the entire latest recording to the server and displays **`sequence`** (e.g. `double_tap → wrist_rotation → tap`) plus **resolved** timed segments. Overlapping raw detections are expected; do not build the password from raw `segments` alone. The current password comparison is local and in-memory: save the resolved sequence as the expected password, then analyze later recordings to show match/mismatch. See **`abracadabra_gesture_processing`** README for precedence rules. The server stores JSON training samples and the trained Random Forest model on its Railway volume, so training and inference should use the same raw sample units.

### Scan list: name vs UUID (iOS)

On iOS, [**MultiplatformBleAdapter**](https://github.com/dotintent/MultiplatformBleAdapter) exposes **`name`** from `CBPeripheral.name` (often **`Arduino`** on mbed if you only looked at that field) and **`localName`** from `CBAdvertisementDataLocalNameKey` (the advertised name). **`App.tsx`** merges scan callbacks and **prefers `localName`** so the row title matches what the firmware broadcasts.

The long **`device.id`** line (UUID format) is **Apple’s peripheral identifier**, not the firmware service UUID.

### Run on a physical iPhone

1. Connect the phone with USB and trust the computer.
2. Open **`ios/AbracadabraRnApp.xcworkspace`** in Xcode → target **AbracadabraRnApp** → **Signing & Capabilities** → select your **Team**.
3. From the project root (with Node 26: `source ~/.nvm/nvm.sh && nvm use 26`):

```sh
npm start
```

In another terminal:

```sh
npx react-native run-ios --device
```

Or pick your device and press Run in Xcode while Metro is running.

To open React Native DevTools, press **`j`** in the Metro terminal.

### Metro + nvm (`env: node: No such file or directory`)

Opening **`node_modules/.generated/launchPackager.command`** uses a bare shell — **`nvm` is not loaded**, so `node` is missing.

- **Recommended:** from the project root, run `source ~/.nvm/nvm.sh && nvm use 26 && npm start`, or double‑click **`StartMetro.command`** in the repo root (same thing; executable wrapper).
- **Xcode builds:** **`ios/.xcode.env.local`** sets **`NODE_BINARY`** after **`nvm use 26`** so Xcode’s shell scripts see `node`. That file is gitignored — start from **`ios/.xcode.env.local.example`** (`cp ios/.xcode.env.local.example ios/.xcode.env.local`) on a new clone.

### Troubleshooting: after upgrading Node

This project expects **Node 26**. If the app used to build under another Node version (for example Node 25.9) and then `nvm use 26` became the new default, do a clean dependency / native rebuild before chasing React Native errors:

```sh
cd /Users/albertocole/xerces_aurora/abracadabra-rnapp
source ~/.nvm/nvm.sh
nvm use 26
rm -rf node_modules
npm install
cd ios
bundle exec pod install
cd ..
npm start -- --reset-cache
```

Then, in another terminal:

```sh
cd /Users/albertocole/xerces_aurora/abracadabra-rnapp
source ~/.nvm/nvm.sh
nvm use 26
npx react-native run-ios --device
```

If the command only prints `xcodebuild exited with error code 70`, rerun with verbose logs:

```sh
source ~/.nvm/nvm.sh
nvm use 26
npx react-native run-ios --device --verbose
```

### Troubleshooting: beta iOS / Developer Disk Image

If the phone is on a beta or very new iOS version, Xcode must have a matching **Developer Disk Image** / device support package. Symptoms include:

- `xcodebuild` reports **exit code 70**.
- Xcode says **The developer disk image could not be mounted on this device**.
- `xcodebuild -showdestinations` cannot find a valid destination.
- Xcode logs mention `com.apple.dt.CoreDeviceError`, `enablePersonalizedDDI`, or `DVTDeviceOperation`.

First confirm Xcode is selected and has iPhoneOS SDKs:

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
xcodebuild -version
xcodebuild -showsdks
```

Then open the workspace in Xcode:

```sh
open /Users/albertocole/xerces_aurora/abracadabra-rnapp/ios/AbracadabraRnApp.xcworkspace
```

In **Window → Devices and Simulators**, select the iPhone and wait for Xcode to finish pairing / preparing device support. If the phone is locked, mounting the DDI can fail with:

```text
kAMDMobileImageMounterDeviceLocked: The device is locked.
```

Fix that by unlocking the iPhone, keeping it on the Home Screen, tapping **Trust This Computer** if prompted, and temporarily setting **Settings → Display & Brightness → Auto-Lock → Never**. Reconnect the phone unlocked if Xcode is still stuck.

If Xcode still cannot mount the DDI for a beta iOS build, install the matching Xcode / Xcode beta for that iOS version, reopen Xcode once so it installs components, then retry the device run.

### Xcode cleanup commands

When Xcode caches get stale, these are safe cleanup steps:

```sh
cd /Users/albertocole/xerces_aurora/abracadabra-rnapp/ios
xcodebuild clean \
  -workspace AbracadabraRnApp.xcworkspace \
  -scheme AbracadabraRnApp \
  -destination 'generic/platform=iOS'
```

If Xcode says no destination exists, use the GUI first (`Window → Devices and Simulators`) because that usually means the physical phone / DDI pairing is not ready yet.

Large Xcode downloads live in these places:

- Simulator runtimes: `/Library/Developer/CoreSimulator/Profiles/Runtimes`
- Simulator device data: `~/Library/Developer/CoreSimulator/Devices`
- Xcode build cache: `~/Library/Developer/Xcode/DerivedData`
- Archives: `~/Library/Developer/Xcode/Archives`
- Device disk images: `/Library/Developer/DeveloperDiskImages`

Prefer **Xcode → Settings → Platforms** to remove old simulator runtimes, then use:

```sh
xcrun simctl delete unavailable
rm -rf ~/Library/Developer/Xcode/DerivedData/*
```

# Getting Started

> **Note**: Make sure you have completed the [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment) guide before proceeding.

## Step 1: Start Metro

First, you will need to run **Metro**, the JavaScript build tool for React Native.

To start the Metro dev server, run the following command from the root of your React Native project:

```sh
# Using npm
npm start

# OR using Yarn
yarn start
```

## Step 2: Build and run your app

With Metro running, open a new terminal window/pane from the root of your React Native project, and use one of the following commands to build and run your Android or iOS app:

### Android

```sh
# Using npm
npm run android

# OR using Yarn
yarn android
```

### iOS

For iOS, remember to install CocoaPods dependencies (this only needs to be run on first clone or after updating native deps).

The first time you create a new project, run the Ruby bundler to install CocoaPods itself:

```sh
bundle install
```

Then, and every time you update your native dependencies, run:

```sh
bundle exec pod install
```

For more information, please visit [CocoaPods Getting Started guide](https://guides.cocoapods.org/using/getting-started.html).

```sh
# Using npm
npm run ios

# OR using Yarn
yarn ios
```

If everything is set up correctly, you should see your new app running in the Android Emulator, iOS Simulator, or your connected device.

This is one way to run your app — you can also build it directly from Android Studio or Xcode.

## Step 3: Modify your app

Now that you have successfully run the app, let's make changes!

Open `App.tsx` in your text editor of choice and make some changes. When you save, your app will automatically update and reflect these changes — this is powered by [Fast Refresh](https://reactnative.dev/docs/fast-refresh).

When you want to forcefully reload, for example to reset the state of your app, you can perform a full reload:

- **Android**: Press the <kbd>R</kbd> key twice or select **"Reload"** from the **Dev Menu**, accessed via <kbd>Ctrl</kbd> + <kbd>M</kbd> (Windows/Linux) or <kbd>Cmd ⌘</kbd> + <kbd>M</kbd> (macOS).
- **iOS**: Press <kbd>R</kbd> in iOS Simulator.

## Congratulations! :tada:

You've successfully run and modified your React Native App. :partying_face:

### Now what?

- If you want to add this new React Native code to an existing application, check out the [Integration guide](https://reactnative.dev/docs/integration-with-existing-apps).
- If you're curious to learn more about React Native, check out the [docs](https://reactnative.dev/docs/getting-started).

# Troubleshooting

If you're having issues getting the above steps to work, see the [Troubleshooting](https://reactnative.dev/docs/troubleshooting) page.

# Learn More

To learn more about React Native, take a look at the following resources:

- [React Native Website](https://reactnative.dev) - learn more about React Native.
- [Getting Started](https://reactnative.dev/docs/environment-setup) - an **overview** of React Native and how setup your environment.
- [Learn the Basics](https://reactnative.dev/docs/getting-started) - a **guided tour** of the React Native **basics**.
- [Blog](https://reactnative.dev/blog) - read the latest official React Native **Blog** posts.
- [`@facebook/react-native`](https://github.com/facebook/react-native) - the Open Source; GitHub **repository** for React Native.
