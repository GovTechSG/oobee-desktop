const os = require("os");
const path = require("path");

// Bundle the correct llama-server binary for the target platform+arch as an
// extraResource. The `make-*` scripts in package.json set TARGET_PLATFORM /
// TARGET_ARCH and invoke `scripts/fetch-llama-binaries.js` to drop the
// extracted binary into resources/<platform>-<arch>/llama-server/ — we hand
// that folder to electron-forge below so it lands at <app>/Resources/llama-server/
// in the packaged app (llamaServer.js resolves that path at runtime).
//
// TARGET_* env vars let a macOS developer package for win32-arm64 (or vice
// versa) without ending up with the host's binary in the bundle.
const targetPlatform = process.env.TARGET_PLATFORM || process.platform;
const targetArch = process.env.TARGET_ARCH || process.env.npm_config_arch || os.arch();
const llamaBinaryDir = path.join(
  __dirname,
  "resources",
  `${targetPlatform}-${targetArch}`,
  "llama-server"
);

module.exports = {
  packagerConfig: {
    icon: 'public/oobee-logo',
    // Declares the `oobee://` URL scheme in macOS Info.plist so Launch
    // Services routes browser clicks (`oobee://unlock-llm/<uuid>`) into
    // the running app. Windows/Linux use runtime registration in main.js.
    protocols: [
      {
        name: 'Oobee',
        schemes: ['oobee'],
      },
    ],
    osxUniversal: { // config options for `@electron/universal`
      x64ArchFiles: "*" // replace with any relevant glob pattern
    },
    ...(process.env.APPLE_ID && {
      osxSign: {
        hardenedRuntime: true,
        'gatekeeper-assess': false,
      }, 
      osxNotarize: {
        tool: 'notarytool',
        appleId: process.env.APPLE_ID,
        appleIdPassword: process.env.APPLE_PASSWORD,
        teamId: process.env.APPLE_TEAM_ID
      }
    }),
    ignore: [
      'nodejs-mac-arm64',
      'nodejs-mac-x64',
      'build/electron',
      'build/oobee-logo',
      'errors.txt',
      'tests',
      'Test.md',
      'playwright-report',
      'installer.ps1',
      'a11y_for_windows.iss',
      '.github',
      // The full resources/ tree contains binaries for every platform we build
      // for — the extraResource below picks only the current target's folder.
      // Excluding the tree from the app bundle avoids shipping all three copies.
      /^\/resources(\/|$)/,
      /^\/\.cache(\/|$)/,
    ],
    extraResource: [
      llamaBinaryDir,
      ...(os.platform() === 'darwin' ? ["/tmp/oobee-portable-mac.zip"] : []),
    ],
  },
  rebuildConfig: {
    onlyModules: [],
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32']
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
};
