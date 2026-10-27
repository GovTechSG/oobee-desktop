# Internationalisation (i18n)

The UI is available in English (`en`) and Japanese (`ja`).

## How the language is chosen

- `public/electron/localeManager.js` (main process) resolves the language: **Japanese** when the first entry of `app.getPreferredSystemLanguages()` **or** `app.getSystemLocale()` (regional format) is `ja*`; otherwise **English**. Japanese as only a secondary preferred language does not switch the UI.
- The renderer gets it via the `getLocaleInfo` IPC (`window.services.getLocaleInfo()`), registered in `main.js` before any window loads.
- `src/i18n/index.jsx` (`I18nProvider`, `useTranslation`) wraps `<App />` in `src/index.js`. It renders nothing until the language is known (no English flash). This works because the main process only sends `appStatus` / `userDataExists` after `guiReady`, which `App` sends once mounted. Do not move the provider below `App`'s status switch.
- It sets `<html lang>`, which drives the Japanese font fallback in `App.css` (`:lang(ja)` → Hiragino / Yu Gothic UI / Meiryo; PT Sans and Open Sans have no Japanese glyphs).
- Dev/QA overrides: `OOBEE_DESKTOP_LANGUAGE=ja|en`, `OOBEE_DESKTOP_REGION=<ISO 3166 alpha-2>`.
- `scanManager.getScanOptions()` passes `--lang` from the main-process `localeManager.getLocaleInfo()` to the engine, so new reports follow the Desktop language. Replacing the backend alone does not select a report language; the engine defaults to English without an explicit language setting.

## Rules

- Every user-visible string — including `aria-label`, `alt`, tooltips, `alert()` text, screen-reader `role="status"` text and validation errors — goes through `t('key', vars)`.
- Add every new key to **both** `src/i18n/locales/en.json` and `ja.json`. `tests/unit/locales.test.mjs` fails on missing keys, mismatched `{placeholders}` / `<tags>`, keys used in `src` but missing from `en.json`, and untranslated Japanese values.
- Message syntax (`src/i18n/format.js`): `{var}` substitution; `<tag>text</tag>` calls `vars.tag(text)` to wrap rich text (links, `<b>`, `<strong>`); plurals use `key_one` / `key_other` with `{ count }`. Never split a sentence into several keys and concatenate — word order differs in Japanese.
- **Internal identifiers stay English.** Scan type labels (`'Custom flow'`, `'Local file'`, …), viewport and file type values, and sentinels such as `CHOOSE_FILE_PLACEHOLDER` are compared in code and persisted in `sessionStorage`. Translate only at display time (`SelectField` `getOptionLabelKey`, `scanTypeLabelKey` / `viewportLabelKey` / `fileTypeLabelKey` in `constants.js`). The "Home Page Scan-Type UI Logic" rules above still apply unchanged.
- Never branch on translated text. `HomePage` uses `URL_ERROR_LOGIN_REQUIRED` / `URL_ERROR_NO_CHROME` error types instead of matching error-message substrings.
- `urlCheckStatuses[*].message` is the English fallback only; display uses `t(urlCheckMessageKey(code))`.
- Release notes / announcements from the remote catalog are not translated.

---

# Telemetry Opt-out

## Behaviour

- The option "Opt out of accessibility scan telemetry" appears in onboarding step 5 and in **Edit your profile** when `localeInfo.telemetryOptOutAvailable` is true: the OS region (`app.getLocaleCountryCode()`, falling back to the region subtag of `getSystemLocale()`) is known and is not `SG`, **or** the user has already opted out (so they can review or undo it). An unknown region keeps the existing behaviour (no option).
  - On **Windows** `getLocaleCountryCode()` returns the country of the **Regional format** (`GetLocaleInfoEx(LOCALE_NAME_USER_DEFAULT, LOCALE_SISO3166CTRYNAME)`), not the separate **Country or region** (GeoID) setting. A Windows user in Singapore usually has "English (Singapore)", so changing only "Country or region" will not show the option. Regional formats without a country (e.g. "English (World)") resolve to an unknown region, so the option stays hidden.
  - On **macOS** it is the **Region** setting.
  - Both language and region are read once per launch (and on profile save); restart the app after changing OS settings.
- Ticking it blanks and disables name and e-mail. Onboarding then submits `{ name: '', email: '', telemetryOptOut: true }` via the "Continue" button.
- `userDataManager.isUserProfileComplete()` treats an opted-out profile as complete, so onboarding is not shown again.

## Main-process enforcement (`userDataManager.applyTelemetryOptOutPolicy`)

- `telemetryOptOut` is in `RENDERER_WRITABLE_FIELDS`, but only a strict boolean is accepted.
- A **new** opt-out is accepted only outside Singapore (`localeManager.isOutsideSingapore()`), so a compromised renderer cannot bypass the UI gate. An existing opt-out is always kept; opting back in is always allowed.
- While opted out, `name` and `email` are always written as `''`.

## What opting out disables

- **Scans** (`scanManager.js`): `-k name:email` is omitted, `OOBEE_SENTRY_DSN` is removed and `OOBEE_DISABLE_TELEMETRY=true` is set (via `telemetry.getScanIdentityArgs` / `applyScanTelemetryEnv`). `scanDetails.telemetryOptOut` is always taken from the main-process `userData`, never from the renderer. Requires engine ≥ 0.11.18, where `-k` is optional once `OOBEE_DISABLE_TELEMETRY` is set.
- **Oobee Desktop Sentry** (`public/electron/telemetry.js`): at startup `initSentry()` reads `userData.txt` and does not call `Sentry.init()` at all when opted out (no sessions, traces, breadcrumbs or crash uploads). `captureMessage` / `setUser` are no-ops. Opting out mid-session sets `enabled = false` on the client, calls `Sentry.close(0)`, and `beforeSend` / `beforeSendTransaction` / `beforeBreadcrumb` drop anything still queued. Opting back in takes effect on the next launch (the UI says so).

## Guardrails

- **Never `require('@sentry/electron')` outside `telemetry.js`.** `tests/unit/telemetry.test.js` fails if any other `public/electron/*.js` file imports it.
- Any new telemetry (Sentry events, form submissions, analytics) must check `telemetry.isTelemetryOptedOut()` or go through `telemetry.js`.
- Any new code path that spawns the engine must use `getScanIdentityArgs` and `applyScanTelemetryEnv`.

## Tests

```shell
node --test tests/unit/*.test.*                                    # main-process + locale files (no Electron)
CI=true DISABLE_ESLINT_PLUGIN=true npx react-scripts test --watchAll=false src/i18n   # render tests
```

`DISABLE_ESLINT_PLUGIN=true` is needed because the repo's `eslint-config-react-app` setup currently fails with `Environment key "jest/globals" is unknown` (pre-existing; also on `main`).

---

# Home Page Scan-Type UI Logic

This document defines the expected UI behavior for scan type handling in:

- `src/MainWindow/HomePage/InitScanForm.jsx`
- `src/MainWindow/HomePage/AdvancedScanOptions.jsx`
- `src/MainWindow/HomePage/index.jsx` (scan submission + validation behavior)

## Scan Types

From `src/common/constants.js`:

1. `Intelligent crawler`
2. `Sitemap crawler`
3. `Website crawler`
4. `Custom flow`
5. `Local file`

---

## Core Rules

- Avoid index-based assumptions when UI options are filtered.
- Prefer explicit scan type labels for conditional rendering in advanced options.
- URL/File mode switching must preserve a valid non-file scan type.
- `Local file` must only be used as file-mode scan type, not cached as URL-mode fallback.

---

## URL vs File Toggle Behavior

### URL mode
- Scan Type options include all except `Local file`.
- URL/File toggle is:
  - shown for all URL-mode scan types except `Custom flow`
  - hidden for `Custom flow`

### File mode
- Scan Type options must be exactly:
  1. `Local file`
  2. `Sitemap crawler`
  3. `Custom flow`
- URL/File toggle must remain visible so user can switch back to URL.
- Default selection on URL → File toggle is `Local file`.

### Restoring File → URL mode
- Restore the last cached non-file scan type.
- If cached non-file scan type is `Local file`, fallback to `Intelligent crawler`.
- Do not cache `Local file` as `cachedNonFileScanType`.

---

## Control Visibility Matrix

| Control | Intelligent | Sitemap | Website | Custom flow | Local file |
|---|---|---|---|---|---|
| URL/File toggle (URL mode) | Show | Show | Show | Hide | N/A |
| URL/File toggle (File mode) | N/A | N/A | N/A | N/A | Show |
| Capped at N pages | Show | Show | Show | Hide | Hide |
| File Type dropdown | Show | Show | Show | Hide | Show |
| Allow subdomains for scans | Show | Hide | Show | Hide | Hide |
| Slow Scan Mode | Show | Show | Show | Hide | Hide |
| Adhere to robots.txt | Show | Hide | Show | Hide | Hide |

---

## File-Type Handling in File Mode

- `Local file`: allow webpage/pdf extensions (`.html`, `.htm`, `.shtml`, `.xhtml`, `.pdf`)
- `Sitemap crawler`: allow sitemap extensions (`.xml`, `.txt`)
- `Custom flow`: allow webpage/pdf extensions (`.html`, `.htm`, `.shtml`, `.xhtml`, `.pdf`) (same as website crawl)

---

## Submission & Validation Rules

- On a successful scan, every scan type (including `Custom flow`) navigates straight to `/result`. There is no separate custom flow screen after the scan: the custom flow report label is requested in the scan browser during the scan, not in the desktop app.
- In file mode, **do not force** `scanType` to `Local file` during submit.
- Submit the currently selected file-mode scan type (`Local file` / `Sitemap crawler` / `Custom flow`).
- Persist the actual selected `scanType`; use `isFileOptionChecked` to determine URL vs FILE mode.
- In `HomePage/index.jsx` validation:
  - `Sitemap crawler`: allow `http(s)://` and `file://`
  - `Local file`: allow `file://` only
  - `Custom flow`: allow `http(s)://` and `file://`

---

## Guardrails for Future Changes

- If scan type list order changes, behavior must not break.
- Keep conditional logic label-based where options can be filtered.
- When changing file-mode options, retest:
  - URL → File toggle
  - File → URL toggle
  - dropdown persistence
  - visibility matrix above
  - file-mode submit payload uses selected scan type (not forced `Local file`)
  - file-mode `Custom flow` with valid `file://` path does not show `Invalid URL.`

---

# Auto-Update System

This document defines the update mechanism behavior in:

- `public/electron/updateManager.js`
- `public/electron/main.js`

## Platform-Specific Update Flows

### Windows Update Flow

**Uses Installer-Based Updates:**

1. **PowerShell Check**: Verifies PowerShell is available (line 321)
2. **Download**: Uses PowerShell `System.Net.WebClient` to download installer package
3. **Extract**: Uses `Expand-Archive` to unzip to `%APPDATA%\Oobee\oobee-desktop-windows\`
4. **Launch Installer**: Spawns `Oobee-setup.exe` as detached process
5. **Exit**: App exits, installer handles replacement

**Key Points:**
- Backend is packaged in the installer (no separate backend update)
- Installer handles privilege elevation automatically
- Uses `installerLaunched` event to trigger app exit
- No custom relaunch logic needed (installer handles it)

**PowerShell Script:**
```powershell
$webClient = New-Object System.Net.WebClient
$webClient.DownloadFile("${downloadUrl}", "${resultsPath}\\oobee-desktop-windows.zip")
Expand-Archive -Path "${resultsPath}\\oobee-desktop-windows.zip" -DestinationPath "${resultsPath}\\oobee-desktop-windows" -Force
```

### macOS Update Flow

**Uses In-Place Binary Replacement:**

1. **Version Check**: Compares current version with latest release
2. **Download**: Downloads update package to temp directory
3. **Privilege Check**: Tests if app location is writable
4. **Installation**: Replaces app bundle (with elevation if needed)
5. **Relaunch**: Uses macOS `open -n` command to launch updated app

---

## macOS Implementation Details

### Privilege Elevation (`updateManager.js`)

**Automatic Detection:**
- Checks if app location is writable using `fs.accessSync()` with `W_OK` flag
- Tests both parent directory and app bundle for write permissions
- Only elevates if **any** path is not writable

**Admin By Request Support:**
- Uses native macOS `osascript` with "administrator privileges"
- Triggers native authentication dialog (compatible with Admin By Request)
- Handles user cancellation gracefully (error code -128 or "User canceled")
- Provides detailed logging for troubleshooting

### Temporary File Naming

**Security Consideration:**
```javascript
const tempAppName = `.Oobee.tmp.${Date.now()}.app`;
```

- Uses hidden file (dot prefix) to avoid macOS security scans
- Timestamp ensures uniqueness
- Prevents "prevented from modifying apps" security warnings
- Deleted immediately after extraction

### Relaunch Mechanism (`main.js`)

**Platform-Specific Handling:**
```javascript
const { spawn } = require('child_process');
spawn('open', ['-n', execPath], {
  detached: true,
  stdio: 'ignore'
}).unref();
```

- Uses macOS `open -n` command instead of `app.relaunch()`
- More reliable after binary replacement
- Works with non-standard installation paths (Downloads, Desktop, etc.)
- 500ms delay ensures spawn executes before exit

### Backend Persistence

**After Update:**
- Checks if backend already exists before setup
- Skips backend extraction if present (handles missing prepackage in updated bundle)
- Prevents "ENOENT: no such file or directory" errors on relaunch

---

## Logging & Debugging

### macOS Privilege Check Output
```
✓ parent directory is writable: /Users/user/Downloads
✓ app bundle is writable: /Users/user/Downloads/Oobee.app
Installing update without elevation (directory is writable)
```

### macOS Elevation Required Output
```
✗ parent directory is NOT writable: /Applications
=== Admin privileges required for app update ===
The app is installed in a location that requires administrator access.
A macOS authentication dialog will appear - please enter your admin credentials.
```

### Windows PowerShell Availability Check
```
PowerShell is not available or is blocked. Skipping PowerShell-dependent step.
```

---

## Event Flow Comparison

### Windows Events
1. `checking` - Checking for updates
2. `promptFrontendUpdate` - User prompt for update
3. `updatingFrontend` - Downloading installer
4. `frontendDownloadComplete` - Prompt to launch installer
5. `installerLaunched` - App exits, installer runs

### macOS Events
1. `checking` - Checking for updates
2. `promptFrontendUpdate` - User prompt for update
3. `updatingFrontend` - Downloading and installing
4. `restartTriggered` - App relaunches with new version
5. `settingUp` - Backend extraction (if needed)

---

## Guardrails for Future Changes

### macOS
- Do not rename temp app to user-visible names (triggers security warnings)
- Always check writability before elevation (don't prompt unnecessarily)
- Use `open -n` for relaunch after binary replacement
- Skip backend setup if already exists (handles update scenarios)
- Test with apps in both writable (Downloads) and protected (/Applications) locations
- Verify Admin By Request environments show native authentication dialog

### Windows
- Always check PowerShell availability before attempting update
- Do not attempt binary replacement (use installer only)
- Ensure installer path exists before spawning
- Use detached process with `unref()` for installer launch
- Backend updates are handled by installer, not separately

### Cross-Platform
- `restartTriggered` event is macOS-only, never emitted on Windows
- `installerLaunched` event is Windows-only, never emitted on macOS
- Version comparison logic is shared across platforms
- Error handling should be platform-aware

---