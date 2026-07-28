# Rename oobee-desktop → a11y-assist-desktop

Renames the desktop app from **Oobee** to **A11y Assist** across code, config, workflows, installer scripts, docs, and assets. Companion to the backend rename in [GovTechSG/oobee → a11y-assist](https://github.com/GovTechSG/oobee).

No back-compat shims — clean rename.

## Naming convention applied

| Context | Before | After |
|---|---|---|
| Code identifier (any case) | `oobee` | `a11yassist` |
| snake_case rule / file / variable | `oobee_accessible_label` | `a11yassist_accessible_label` |
| kebab-case rule / CSS class / npm slug | `oobee-accessible-label`, `.oobee-btn` | `a11yassist-accessible-label`, `.a11yassist-btn` |
| camelCase (JS) | `oobeeAppVersion`, `disableOobee` | `a11yassistAppVersion`, `disableA11yAssist` |
| SCREAMING_SNAKE (env var) | `OOBEE_VERBOSE` | `A11Y_ASSIST_VERBOSE` |
| Display string | `"Oobee"`, `"Oobee Desktop"` | `"A11y Assist"`, `"A11y Assist Desktop"` |
| URL slug / repo name | `oobee`, `oobee-desktop` | `a11y-assist`, `a11y-assist-desktop` |
| npm package | `@govtechsg/oobee` | `@govtechsg/a11y-assist` |
| CLI command | `oobee` | `a11y-assist` |
| Home / install dir (Windows) | `Oobee Desktop`, `Oobee Backend` | `A11y Assist Desktop`, `A11y Assist Backend` |
| Home / support dir (macOS) | `~/Library/Application Support/Oobee` | `~/Library/Application Support/A11y Assist` |
| App bundle (macOS) | `Oobee.app` | `A11y Assist.app` |
| Installer exe (Windows) | `Oobee-setup.exe` | `A11y-Assist-setup.exe` |
| Backend zip artifact | `oobee-portable-{mac,windows}.zip` | `a11y-assist-portable-{mac,windows}.zip` |
| Frontend zip artifact | `oobee-desktop-{macos,windows}.zip` | `a11y-assist-desktop-{macos,windows}.zip` |
| Shell script | `oobee_shell.sh` | `a11y_assist_shell.sh` |

Backend folder name assumption: the CLI backend previously at `GovTechSG/oobee` is now `GovTechSG/a11y-assist`. All release URLs, zip filenames, and internal `enginePath` references updated accordingly.

## Summary of changes

### Build / packaging
- [package.json](package.json), [package-lock.json](package-lock.json) — `name` `purplea11ydesktop` → `a11yassistdesktop`; `productName` `Oobee` → `A11y Assist`; `description` and `make-mac*` scripts updated to reference `a11y-assist` release URLs and mac zip filenames.
- [forge.config.js](forge.config.js) — `icon: 'public/a11y-assist-logo'`, ignore entry `build/a11y-assist-logo`, `extraResource: ["/tmp/a11y-assist-portable-mac.zip"]`.
- [a11y_for_windows.iss](a11y_for_windows.iss) — full rewrite: AppName `A11y Assist Desktop`, source paths `A11y Assist-win32-x64\*` and `D:\a\A11y Assist Backend\*`, install dirs `{autopf}\A11y Assist Desktop` / `{userappdata}\A11y Assist Desktop`, shortcut targets `A11y Assist Frontend\A11y Assist.exe`.

### GitHub Actions
- [.github/workflows/image.yml](.github/workflows/image.yml) — node_modules path, backend download URL/zip, `D:\a\A11y Assist Backend` staging path, installer `A11y-Assist-setup.exe`, artifact zips `a11y-assist-desktop-{windows,macos}.zip`.
- [.github/workflows/generate-release-catalog.yml](.github/workflows/generate-release-catalog.yml) — `GovTechSG/oobee-desktop` → `GovTechSG/a11y-assist-desktop`.

### Electron main process
- [public/electron/constants.js](public/electron/constants.js) — full rewrite of app paths, release/frontend URLs, artifact filenames, `enginePath = path.join(backendPath, "a11y-assist")`, default export dir `Documents/A11y Assist`, PATH glue for both Windows and macOS.
- [public/electron/main.js](public/electron/main.js) — release catalog URL updated to `govtechsg.github.io/a11y-assist-desktop/latest-release.json`.
- [public/electron/scanManager.js](public/electron/scanManager.js) — `-y disable-a11yassist,enable-wcag-aaa`, env vars `A11Y_ASSIST_VERBOSE` / `A11Y_ASSIST_FAST_CRAWLER` / `A11Y_ASSIST_SENTRY_DSN` / `A11Y_ASSIST_ERROR_LOG_PATH`, email body strings updated to reference "A11y Assist" and `go.gov.sg/a11y-assist`.
- [public/electron/updateManager.js](public/electron/updateManager.js) — `./a11y_assist_shell.sh`, frontend/backend download URLs, mac temp zip name, `tempAppName = .A11yAssist.tmp.${Date.now()}.app`, post-extract `xattr` on `${parentDir}/A11y Assist.app`.

### PowerShell / installer
- [scripts/downloadAndUnzipBackend.ps1](scripts/downloadAndUnzipBackend.ps1) — variables renamed to `$a11yAssist*`, install paths updated to `C:\Program Files\A11y Assist Desktop\A11y Assist Backend\a11y-assist`, backend release URL/zip updated.
- [installer.ps1](installer.ps1) — backend/frontend URLs, zip filenames, extract paths, echo messages updated.

### React UI
- [src/services.js](src/services.js) — contact link `go.gov.sg/contact-a11y-assist`.
- [src/common/constants.js](src/common/constants.js) — "A11y Assist team" (was "Oobee team"), "A11y Assist cli" comment.
- [src/App.css](src/App.css) — font import comment.
- [src/MainWindow/HomePage/AboutModal.jsx](src/MainWindow/HomePage/AboutModal.jsx) — logo import, aria-label, modal title, release notes URL (`github.com/GovTechSG/a11y-assist-desktop/releases/tag/${version}`), privacy/terms/vulnerability/third-party-license URLs updated to `go.gov.sg/a11y-assist-*`.
- [src/MainWindow/HomePage/index.jsx](src/MainWindow/HomePage/index.jsx) — logo import, basic-auth modal copy.
- [src/MainWindow/HomePage/NoChromeErrorModal.jsx](src/MainWindow/HomePage/NoChromeErrorModal.jsx), [WhatsNewModal.jsx](src/MainWindow/HomePage/WhatsNewModal.jsx) — display copy and releases URL.
- [src/MainWindow/Onboarding/OnboardingComponent.jsx](src/MainWindow/Onboarding/OnboardingComponent.jsx) — onboarding text.

### Static / HTML
- [public/index.html](public/index.html) — `<title>`, `<meta description>`, favicon href → `a11y-assist-logo.svg`.

### Assets (renamed via `git mv`)
- `public/oobee-logo.{icns,ico,png,svg}` → `public/a11y-assist-logo.{icns,ico,png,svg}`
- `src/assets/logo-oobee-emblem-full-colour.svg` → `src/assets/logo-a11y-assist-emblem-full-colour.svg` (also updated internal Figma layer id)
- `src/assets/logo-oobee-full-colour-FPA-110x40.svg` → `logo-a11y-assist-full-colour-FPA-110x40.svg`
- `src/assets/logo-oobee-full-colour-PBGT-110x65.svg` → `logo-a11y-assist-full-colour-PBGT-110x65.svg`
- `src/assets/logo-oobee-full-colour-PBGT.svg` → `logo-a11y-assist-full-colour-PBGT.svg`
- `src/assets/logo-oobee-full-colour-inverse.svg` → `logo-a11y-assist-full-colour-inverse.svg`

### Documentation
- [README.md](README.md), [INSTALLATION.md](INSTALLATION.md) — retitled and rewritten with `A11y Assist` display strings, new repo/CLI/download URLs, updated app-bundle names. Preserves `formerly known as Oobee / Purple A11y` attribution.
- [AGENTS.md](AGENTS.md) — updated PowerShell script sample, tempAppName sample, macOS log output paths.
- [Test.md](Test.md) — `Oobee` → `A11y Assist`.

## Intentionally left as-is

- **DPG Badge URL** in `README.md` (`digitalpublicgoods.net/r/oobee`) — external redirect controlled by DPG registry.
- **`formerly known as Oobee / Purple A11y`** attribution lines in `README.md` and `INSTALLATION.md`.
- **Legacy GitHub attachment URLs** (`github.com/GovTechSG/oobee*/assets/…`) — images already hosted on GitHub attachments; content cannot be re-uploaded to new repo path without re-linking. Left as documentation-only references.

## Test plan

- [ ] `npm install` succeeds (name change in package.json/lock is consistent).
- [ ] `npm run make-mac` builds `A11y Assist.app` with the `a11y-assist-portable-mac.zip` bundled as extraResource.
- [ ] `npm run make-win` builds `A11y Assist-win32-x64` and InnoSetup produces `A11y-Assist-setup.exe`.
- [ ] Fresh install of `A11y-Assist-setup.exe` creates `C:\Program Files\A11y Assist Desktop\A11y Assist Frontend` and shortcut `A11y Assist Desktop`.
- [ ] `scripts/downloadAndUnzipBackend.ps1 <BE_TAG>` downloads from `github.com/GovTechSG/a11y-assist/releases/...` and extracts to `A11y Assist Backend\a11y-assist`.
- [ ] macOS: launching `A11y Assist.app` unzips backend into `~/Library/Application Support/A11y Assist/A11y Assist Backend/`.
- [ ] Onboarding, home, about, update, and error modals all show "A11y Assist" / "A11y Assist Desktop" (no residual "Oobee").
- [ ] "Report vulnerability", "Privacy statement", "Terms of use", release-notes, and third-party-licenses links in About modal all resolve.
- [ ] Auto-update path on macOS: temp-app extraction uses `.A11yAssist.tmp.*.app`; final bundle written as `A11y Assist.app`.
- [ ] Auto-update path on Windows: installer downloaded as `a11y-assist-desktop-windows.zip`, extracted to `%APPDATA%\A11y Assist\a11y-assist-desktop-windows\`, launched as `A11y-Assist-setup.exe`.
- [ ] `-y` CLI flag passed to backend is `disable-a11yassist,enable-wcag-aaa` / `disable-a11yassist` (matches backend rename).
- [ ] Sentry / verbose / fast-crawler env vars (`A11Y_ASSIST_*`) reach the backend spawn.
