# Abracadabra RN app — troubleshooting

Practical fixes for Mac + physical iPhone development. This project uses **Node 26** (`nvm use 26`), **React Native 0.86**, and **Hermes**.

For environment setup, see [Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment). For generic RN issues, see [React Native troubleshooting](https://reactnative.dev/docs/troubleshooting).

---

## Prerequisites checklist

Before debugging deeper issues:

1. **Node 26** on PATH in every terminal:
   ```sh
   source ~/.nvm/nvm.sh && nvm use 26
   ```
2. **Metro running** in a dedicated terminal (leave it open):
   ```sh
   cd /path/to/abracadabra-rnapp
   source ~/.nvm/nvm.sh && nvm use 26 && npm start
   ```
   Wait for `Dev server ready` on port **8081**.
3. **Physical iPhone:** USB trusted, **Developer Mode** on, same Wi‑Fi as the Mac.
4. **Xcode signing** configured once (see [Code signing](#code-signing-no-ios-development-certificate)).
5. **`ios/.xcode.env.local`** exists and uses **`nvm use 26`** (copy from `ios/.xcode.env.local.example` on a new clone).

---

## Metro does not start (prompt returns immediately)

### Symptom

`npm start` exits right away with **no Metro banner**, or `last_exit_code: 3`.

### Fix

Run commands **on separate lines** or with `&&` so failures are visible:

```sh
cd /path/to/abracadabra-rnapp
source ~/.nvm/nvm.sh
nvm use 26
echo "node: $(node -v)"    # should print v26.4.0 or newer
npm start
```

If `nvm use 26` fails:

```sh
nvm install 26.4.0
nvm use 26
nvm alias default 26
```

### Alternatives

- Double‑click **`StartMetro.command`** in the repo root (loads nvm + Node 26).
- If Metro starts then crashes with **`EMFILE: too many open files`**, install Watchman and retry:
  ```sh
  brew install watchman
  source ~/.nvm/nvm.sh && nvm use 26 && npm start -- --reset-cache
  ```

### `env: node: No such file or directory`

Bare shells (Xcode script phases, Finder `.command` files) do not load nvm. Use `StartMetro.command` or prefix commands with `source ~/.nvm/nvm.sh && nvm use 26 &&`.

---

## App installs but closes immediately on launch

This is **not** usually “wrong iPhone model” or iOS being too old. If Xcode reports **Successfully launched**, the OS and signing are fine — something fails during native startup or JS load.

### Step 1 — Is Metro actually running?

The CLI can report success while Metro is down. You need a **second terminal** with Metro still showing `Dev server ready`.

### Step 2 — Watch Metro when you open the app

Tap the app icon and look at the Metro terminal:

| Metro output | Meaning |
|--------------|---------|
| **No** `BUNDLE ./index.js` | **Native crash before JS** — see [Xcode crash logs](#read-the-crash-in-xcode) and [Hermes mismatch](#hermes--react-native-version-mismatch-dyld-symbol-not-found) |
| **`BUNDLE ./index.js` appears** then app dies | JS error or post-load native crash — open DevTools (`j`) or Xcode console |
| **`BUNDLE` + app stays open** | Working |

### Step 3 — Physical device: reach Metro on your Mac

The phone cannot use `localhost:8081` (that points at the phone itself).

1. Mac and iPhone on the **same Wi‑Fi** (not cellular, not guest network).
2. On first launch after adding local-network keys, tap **Allow** when iOS asks for local network access.
3. Get your Mac’s LAN IP:
   ```sh
   ipconfig getifaddr en0
   ```
4. On the phone: **shake** → Dev Menu → **Configure Bundler** → `192.168.x.x:8081` (your IP).
5. Reload: shake → **Reload**, or press **`r`** in the Metro terminal.

`Info.plist` includes `NSLocalNetworkUsageDescription` and `NSBonjourServices` for Metro discovery. **Rebuild** after changing plist entries.

### Step 4 — Delete stale app, reinstall

Long-press the app → **Remove App**, then rebuild:

```sh
source ~/.nvm/nvm.sh && nvm use 26 && npx react-native run-ios --device "YourDeviceName"
```

### Simulator vs device

```sh
source ~/.nvm/nvm.sh && nvm use 26 && npx react-native run-ios --simulator "iPhone 17"
```

- **Simulator works, device fails** → network / Metro reachability.
- **Both fail** → native binary or JS issue (often Hermes mismatch after upgrade).

---

## Hermes / React Native version mismatch (`dyld: Symbol not found`)

### Symptom (Xcode console)

```text
dyld: Symbol not found: __ZN8facebook3jsi5Array18createWithElementsE...
  Referenced from: .../React.framework/React
  Expected in:     .../hermesvm.framework/hermesvm
```

App dies **before** any Metro `BUNDLE` line. This is a **stale native dependency** after upgrading React Native (e.g. 0.85 → 0.86), not an iPhone hardware problem.

### Cause

`Podfile.lock` had mismatched prebuilt frameworks, for example:

- `React-Core` / `ReactNativeDependencies` at **0.86.0**
- `React-Core-prebuilt` still at **0.85.2**

React 0.86 expects JSI symbols that do not exist in the older Hermes/prebuilt pair.

### Verify

```sh
grep 'React-Core-prebuilt (' ios/Podfile.lock
```

All React/Hermes-related pods should match your `package.json` `react-native` version (e.g. **0.86.0**).

### Fix — full iOS native clean

```sh
cd /path/to/abracadabra-rnapp

# JS deps (if you also bumped package.json)
source ~/.nvm/nvm.sh && nvm use 26
rm -rf node_modules
npm install

# Native clean
rm -rf ios/Pods ios/Podfile.lock ios/build
rm -rf ~/Library/Developer/Xcode/DerivedData/AbracadabraRnApp-*

cd ios
pod install --repo-update
cd ..
```

Delete the app from the phone, then rebuild:

```sh
source ~/.nvm/nvm.sh && nvm use 26 && npx react-native run-ios --device
```

Confirm `Podfile.lock` shows `React-Core-prebuilt (0.86.0)` (or whatever RN version you ship).

---

## Code signing: `No "iOS Development" signing certificate`

### Symptom

```text
error No signing certificate "iOS Development" found ...
error Failed to build ios project. "xcodebuild" exited with error code '65'.
```

### Fix (one-time in Xcode)

1. Open the **workspace** (not `.xcodeproj`):
   ```sh
   open ios/AbracadabraRnApp.xcworkspace
   ```
2. **Xcode → Settings → Accounts** — sign in with your Apple ID.
3. Select project **AbracadabraRnApp** → target **AbracadabraRnApp** → **Signing & Capabilities**.
4. Enable **Automatically manage signing**, pick your **Team**, fix **Bundle Identifier** if needed (must be unique).
5. Select your iPhone as run destination → **Run** (`Cmd+R`).
6. On the phone: **Settings → General → VPN & Device Management** → trust the developer app.

CLI builds work after signing is fixed in Xcode.

---

## Read the crash in Xcode

When the app closes instantly and Metro shows no `BUNDLE`:

1. Keep Metro running.
2. Open `ios/AbracadabraRnApp.xcworkspace`.
3. Select the physical device → **Run**.
4. **View → Debug Area → Activate Console** (`Cmd+Shift+C`).
5. Copy red error lines (`dyld`, `Symbol not found`, `RCTFatal`, etc.).

Optional: stream device logs:

```sh
npx react-native log-ios
```

---

## React Native DevTools

With Metro running, press **`j`** in the Metro terminal to open DevTools in the browser (components, console, profiler).

From the device: shake → Dev Menu → **Open DevTools** (wording may vary by RN version).

Docs: [Debugging](https://reactnative.dev/docs/debugging), [React Native DevTools](https://reactnative.dev/docs/react-native-devtools).

---

## After upgrading React Native (e.g. 0.85 → 0.86)

1. Align **`@react-native/*` devDependencies** in `package.json` to the same minor as `react-native` (e.g. `0.86.0`).
2. `npm install`
3. Run the [Hermes / native clean](#fix--full-ios-native-clean) steps above — **do not skip** `rm Podfile.lock` and DerivedData.
4. `pod install` in `ios/`
5. Rebuild on device; delete old app from phone first.

RN 0.86 release notes: [React Native 0.86](https://reactnative.dev/blog/2026/06/11/react-native-0.86).

---

## After upgrading Node (use Node 26)

```sh
cd /path/to/abracadabra-rnapp
source ~/.nvm/nvm.sh
nvm use 26
rm -rf node_modules
npm install
cd ios && bundle exec pod install && cd ..
npm start -- --reset-cache
```

Ensure `ios/.xcode.env.local` contains `nvm use 26`, not an older version.

---

## Beta iOS / Developer Disk Image

If the phone runs a **beta iOS**, Xcode needs a matching Developer Disk Image. Symptoms: `xcodebuild` exit **70**, “developer disk image could not be mounted”, device missing from destinations.

See also **README.md** § “Troubleshooting: beta iOS / Developer Disk Image” for DDI pairing, unlock phone, matching Xcode beta.

---

## Xcode cache cleanup

When builds behave oddly after pod or RN upgrades:

```sh
cd ios
xcodebuild clean \
  -workspace AbracadabraRnApp.xcworkspace \
  -scheme AbracadabraRnApp \
  -destination 'generic/platform=iOS'
rm -rf ~/Library/Developer/Xcode/DerivedData/AbracadabraRnApp-*
```

---

## Quick reference

| Problem | Likely fix |
|---------|------------|
| `npm start` exits silently | `nvm use 26` on its own line; install Node 26 |
| App closes instantly, no `BUNDLE` in Metro | Hermes/RN pod mismatch → [native clean](#fix--full-ios-native-clean) |
| App closes, `BUNDLE` appears | Configure bundler IP; check JS errors in DevTools (`j`) |
| `xcodebuild` exit 65 | Fix signing in Xcode |
| `Symbol not found` + `hermesvm` | Stale `React-Core-prebuilt` → pod clean + reinstall |
| `command not found: npm` | `source ~/.nvm/nvm.sh && nvm use 26` |
| DevTools | Press **`j`** in Metro terminal |
