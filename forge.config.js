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
  const candidates = candidateTargetKeys(platform, normalizeArch(arch)).map((key) =>
    path.join(__dirname, 'resources', key, 'llama-server')
  );
  const existing = candidates.find((dir) => fs.existsSync(dir));
  if (existing) return existing;
  return candidates[0];
}

// `--arch=universal --platform darwin` (the `make-mac` script) makes
// electron-forge invoke @electron/packager twice under the hood — once for
// x64, once for arm64 — before merging the two into a single fat app via
// @electron/universal. `packagerConfig.extraResource` below is evaluated
// once at config-load time, so it always points at whichever TARGET_ARCH the
// npm script happened to export (arm64) — that's correct for the arm64 pass
// but wrong for the x64 pass, silently shipping an arm64 llama-server binary
// inside the x64 half of the universal app.
//
// Fix: after each pass copies extraResource, re-resolve the correct binary
// for the pass's *actual* `arch` (passed in by the hook) and swap it in if it
// doesn't match what got statically copied. `@electron/universal`'s
// `x64ArchFiles: '*'` (below) then lipo-merges the two arch-correct
// `llama-server` executables into one universal binary, so the OS picks the
// right slice at runtime regardless of which Electron arch is running —
// no changes needed in llamaServer.js's runtime resolution.
function findStagedLlamaServerDir(root) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name === 'llama-server') return full;
      stack.push(full);
    }
  }
  return null;
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
    afterCopyExtraResources: [
      (stagingPath, electronVersion, platform, arch, callback) => {
        try {
          const correctDir = resolveLlamaBinaryDir(platform, arch);
          if (path.resolve(correctDir) !== path.resolve(llamaBinaryDir)) {
            const stagedDir = findStagedLlamaServerDir(stagingPath);
            if (!stagedDir) {
              console.warn(
                `[forge.config] could not locate staged llama-server dir under ${stagingPath} to fix up for ${platform}-${arch}`
              );
            } else {
              fs.rmSync(stagedDir, { recursive: true, force: true });
              // verbatimSymlinks: true keeps the tarball's sibling-relative
              // symlinks (`libggml.dylib -> libggml.0.dylib`) intact. Without
              // it, Node rewrites relative targets against the source path,
              // producing links that escape the .app bundle — which trips
              // @electron/universal's mach-o walker during the universal
              // stitch (the "number of mach-o files" mismatch).
              fs.cpSync(correctDir, stagedDir, { recursive: true, verbatimSymlinks: true });
              console.log(`[forge.config] swapped in ${platform}-${arch} llama-server binary for this packaging pass`);
            }
          }

          // Windows x64 builds run natively on x64 hardware, but also run
          // under Prism/WOW64 emulation on real ARM64 hardware — where the
          // emulated x64 binary works but loses out on native performance.
          // Bundle the arm64 binary too, as a sibling `llama-server-arm64`
          // folder, so llamaServer.js can detect real ARM64 hardware at
          // runtime (PROCESSOR_ARCHITEW6432) and prefer the native binary.
          if (platform === 'win32' && normalizeArch(arch) === 'x64') {
            const arm64Dir = resolveLlamaBinaryDir('win32', 'arm64');
            if (fs.existsSync(arm64Dir)) {
              const stagedDir = findStagedLlamaServerDir(stagingPath);
              if (stagedDir) {
                const arm64Dest = path.join(path.dirname(stagedDir), 'llama-server-arm64');
                fs.rmSync(arm64Dest, { recursive: true, force: true });
                fs.cpSync(arm64Dir, arm64Dest, { recursive: true, verbatimSymlinks: true });
                console.log('[forge.config] bundled win32-arm64 llama-server alongside x64 for Prism-emulation fallback');
              }
            } else {
              console.warn(
                `[forge.config] win32-arm64 llama-server binary not found at ${arm64Dir} — ` +
                  'ARM64 hardware running this x64 build will fall back to emulated x64. ' +
                  'Run: node scripts/fetch-llama-binaries.js --target win32-arm64'
              );
            }
          }

          callback();
        } catch (err) {
          callback(err);
        }
      },
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
