const os = require("os");

module.exports = {
  packagerConfig: {
    icon: 'public/oobee-logo',
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
  rebuildConfig: {},
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
