This is a new [**React Native**](https://reactnative.dev) project, bootstrapped using [`@react-native-community/cli`](https://github.com/react-native-community/cli).

## Bluetooth (BLE)

This app uses [**react-native-ble-plx**](https://github.com/dotintent/react-native-ble-plx) to scan, **connect**, discover GATT, and **subscribe** to the wearable’s NOTIFY stream.

- **iOS:** `ios/AbracadabraRnApp/Info.plist` includes `NSBluetoothAlwaysUsageDescription` and `NSBluetoothPeripheralUsageDescription`. After changing native deps: `cd ios && bundle exec pod install`.
- **Flow:** Auto-scan for **`XA_Abracadabra`** → connect → discover → monitor **`ADAB0003-…`** on service **`ADAB0001-…`**. After an **accepted** double-tap recording on the MCU, the peripheral pushes **META → CHUNK\* → COMMIT** framed packets (`bleRecordingProtocol.ts`). Partial or CRC-failed transfers are **rolled back** (discarded). Samples render as a Skia **motion trail + energy ribbon** (`ImuMotionSkia.tsx`).
- **Reconnect:** After an unexpected disconnect, the app waits ~**1.8 s** and reconnects automatically (same peripheral id), up to **15** tries, then shows **Link Lost** until **Scan Again**.
- **Android:** `requestMTU(247)` runs after connect when supported (larger chunks).

This repo is set up for **iPhone** deployment; the React Native template still includes an `android/` folder.

### Pairing with **abracadabra-platformio**

Firmware exposes `kBleDeviceName` (e.g. **XA_Abracadabra**), GATT service **`ADAB0001-0000-1000-8000-00805F9B34FB`**, and NOTIFY **`ADAB0003-0000-1000-8000-00805F9B34FB`** for recordings (see firmware README for framing).

### Scan list: name vs UUID (iOS)

On iOS, [**MultiplatformBleAdapter**](https://github.com/dotintent/MultiplatformBleAdapter) exposes **`name`** from `CBPeripheral.name` (often **`Arduino`** on mbed if you only looked at that field) and **`localName`** from `CBAdvertisementDataLocalNameKey` (the advertised name). **`App.tsx`** merges scan callbacks and **prefers `localName`** so the row title matches what the firmware broadcasts.

The long **`device.id`** line (UUID format) is **Apple’s peripheral identifier**, not the firmware service UUID.

### Run on a physical iPhone

1. Connect the phone with USB and trust the computer.
2. Open **`ios/AbracadabraRnApp.xcworkspace`** in Xcode → target **AbracadabraRnApp** → **Signing & Capabilities** → select your **Team**.
3. From the project root (with Node 25: `source ~/.nvm/nvm.sh && nvm use 25`):

```sh
npm start
```

In another terminal:

```sh
npx react-native run-ios --device
```

Or pick your device and press Run in Xcode while Metro is running.

### Metro + nvm (`env: node: No such file or directory`)

Opening **`node_modules/.generated/launchPackager.command`** uses a bare shell — **`nvm` is not loaded**, so `node` is missing.

- **Recommended:** from the project root, run `source ~/.nvm/nvm.sh && nvm use 25 && npm start`, or double‑click **`StartMetro.command`** in the repo root (same thing; executable wrapper).
- **Xcode builds:** **`ios/.xcode.env.local`** sets **`NODE_BINARY`** after **`nvm use 25`** so Xcode’s shell scripts see `node`. That file is gitignored — start from **`ios/.xcode.env.local.example`** (`cp ios/.xcode.env.local.example ios/.xcode.env.local`) on a new clone.

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
