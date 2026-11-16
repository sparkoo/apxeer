# Apxeer desktop

The Windows recorder reads Le Mans Ultimate telemetry from shared memory and
imports session results from the game's XML files.

## Run from source

Install Node.js 22+, Rust with the Windows MSVC toolchain, the Visual Studio
C++ build tools, and WebView2. From this directory, run:

```sh
npm ci
npm run tauri -- dev
```

## Configure the recorder

1. Set the API URL in Settings. For a local API, use `http://localhost:8080`
   and follow the [local setup](../README.md#local-development).
2. In the corresponding Clerk instance, create a public OAuth application
   with redirect URI `http://127.0.0.1:54321/`. Enter the Clerk Frontend API
   domain and OAuth application's client ID in Settings.
3. Set the LMU results directory to the game's `UserData/Log/Results` folder
   to import race results, then restart Apxeer so it watches that folder. Start
   LMU to record telemetry.
4. Sign in and upload manually, or enable auto-upload in Settings.

Settings and pending uploads live under the Tauri app data directory.

## Show live telemetry in LMU

1. Run Le Mans Ultimate in borderless windowed mode on the primary display.
2. In Apxeer's recorder panel, enable **Show telemetry overlay**.
3. Enter a car. The click-through HUD in the upper-left corner shows speed in
   km/h, gear, throttle, and brake, including on the out-lap.

The HUD stays above other windows while enabled. Turn it off in the recorder
panel or close Apxeer to remove it. It works locally without signing in.
