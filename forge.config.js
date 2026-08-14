const os = require("os");

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
    // node-llama-cpp ships prebuilt native binaries (.node / .dylib / .dll);
    // these can't live inside asar, so unpack the whole module tree so
    // dynamic loading + the on-disk model cache work in packaged builds.
    asar: {
      unpack: '**/node_modules/{node-llama-cpp,@node-llama-cpp/**}/**/*',
    },
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
      '.github'
    ],
    ...(os.platform() === 'darwin' && { extraResource: ["/tmp/oobee-portable-mac.zip"]})
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
