const os = require("os");
const path = require("path");
const fs = require("fs");

// Bundle the correct llama-server binary for the target platform+arch as an
// extraResource. The `make-*` scripts in package.json set TARGET_PLATFORM /
// TARGET_ARCH and invoke `scripts/fetch-llama-binaries.js` to drop the
// extracted binary into resources/<platform>-<arch>/llama-server/ — we hand
// that folder to electron-forge below so it lands at <app>/Resources/llama-server/
// in the packaged app (llamaServer.js resolves that path at runtime).
//
// TARGET_* env vars let a macOS developer package for win32-arm64 (or vice
// versa) without ending up with the host's binary in the bundle.
function normalizeArch(raw) {
  const arch = String(raw || '').toLowerCase();
  if (arch === 'x86' || arch === 'i386' || arch === 'i686') return 'ia32';
  if (arch === 'x86_64' || arch === 'amd64') return 'x64';
  if (arch === 'aarch64') return 'arm64';
  return arch;
}

function candidateTargetKeys(platform, arch) {
  const keys = [`${platform}-${arch}`];
  if (platform === 'win32' && (arch === 'arm64' || arch === 'ia32')) {
    keys.push('win32-x64');
  }
  return [...new Set(keys)];
}

function resolveLlamaBinaryDir(platform, arch) {
  const candidates = candidateTargetKeys(platform, arch).map((key) =>
    path.join(__dirname, 'resources', key, 'llama-server')
  );
  const existing = candidates.find((dir) => fs.existsSync(dir));
  if (existing) return existing;
  return candidates[0];
}

const targetPlatform = process.env.TARGET_PLATFORM || process.platform;
const targetArch = normalizeArch(process.env.TARGET_ARCH || process.env.npm_config_arch || os.arch());
const llamaBinaryDir = resolveLlamaBinaryDir(targetPlatform, targetArch);

// PRE_RELEASE builds swap the purple app icon for a pre-generated grey one so
// QA and staged installs are visually distinguishable from the shipped app.
const preReleaseFlag = String(process.env.PRE_RELEASE || '').toLowerCase();
const isPreRelease = preReleaseFlag === '1' || preReleaseFlag === 'true' || preReleaseFlag === 'yes';
const iconBaseName = isPreRelease ? 'public/oobee-logo-prerelease' : 'public/oobee-logo';

module.exports = {
  packagerConfig: {
    icon: iconBaseName,
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
