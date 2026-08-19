const os = require("os");

// PRE_RELEASE builds swap the purple app icon for a pre-generated grey one so
// QA and staged installs are visually distinguishable from the shipped app.
const preReleaseFlag = String(process.env.PRE_RELEASE || '').toLowerCase();
const isPreRelease = preReleaseFlag === '1' || preReleaseFlag === 'true' || preReleaseFlag === 'yes';
const iconBaseName = isPreRelease ? 'public/oobee-logo-prerelease' : 'public/oobee-logo';

module.exports = {
  packagerConfig: {
    icon: iconBaseName,
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
