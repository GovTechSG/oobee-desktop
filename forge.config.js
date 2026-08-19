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
// npm script happened to export — correct for that pass but wrong for the
// other, silently shipping the wrong arch's llama-server inside one half of
// the universal app.
//
// Fix, part 1: after each pass copies extraResource, re-resolve the correct
// binary for the pass's *actual* `arch` (passed in by the hook) and swap it
// in. `@electron/universal`'s `x64ArchFiles: '*'` (below) then lipo-merges
// the two arch-correct `llama-server` executables into one universal binary.
//
// Fix, part 2 (darwin only): llama.cpp ships `libggml-metal.*.dylib` in the
// arm64 archive but not x64 (Apple's Metal is Intel-Mac capable, but llama.cpp
// only compiles a Metal backend for arm64). @electron/universal@2.x aborts
// the merge with a "number of mach-o files is not the same" mismatch as soon
// as the two per-arch trees have different file sets — and its `x64ArchFiles`
// glob is checked *after* the strict set-equality guard, so it can't rescue
// us here (v3's `singleArchFiles` could, but @electron/packager pins
// `^2.0.1`). So each per-arch pass overlays the *other* arch's staged tree
// as a base and then this arch's tree on top: shared libs come from the
// current arch, each arch's unique files ride along on the other side as
// unused sidecars. The Metal dylib on the x64 slice is never dlopened at
// runtime (x64 llama-server isn't linked against libggml-metal), so it's
// dead weight but harmless; identical bytes mean SHAs match and universal
// treats it as an already-merged file (no lipo, no arch downgrade).
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
          const isDarwinUniversalPass =
            platform === 'darwin' && (normalizeArch(arch) === 'x64' || normalizeArch(arch) === 'arm64');

          if (isDarwinUniversalPass) {
            // Rebuild the staged tree so each darwin slice ends up with the
            // same file set (see the module-level comment above). First copy
            // the current arch's tree fresh, then top up with any file the
            // other arch has that this one doesn't (the arm64 libggml-metal
            // chain). Done as a two-step "correct-arch first, then sidecar"
            // rather than a single overlay because Node's fs.cpSync throws
            // EEXIST when verbatimSymlinks:true is combined with an existing
            // destination directory — but the sidecar entries we want to
            // add never overlap with correctDir by construction, so we can
            // walk the other arch and copy the missing entries manually
            // (preserving symlink targets verbatim via readlink/symlink).
            const otherArch = normalizeArch(arch) === 'x64' ? 'arm64' : 'x64';
            const otherDir = resolveLlamaBinaryDir('darwin', otherArch);
            const stagedDir = findStagedLlamaServerDir(stagingPath);
            if (!stagedDir) {
              console.warn(
                `[forge.config] could not locate staged llama-server dir under ${stagingPath} to fix up for darwin-${arch}`
              );
            } else {
              fs.rmSync(stagedDir, { recursive: true, force: true });
              fs.cpSync(correctDir, stagedDir, { recursive: true, verbatimSymlinks: true });
              let sidecarCount = 0;
              if (fs.existsSync(otherDir)) {
                const owned = new Set(fs.readdirSync(correctDir));
                for (const entry of fs.readdirSync(otherDir, { withFileTypes: true })) {
                  if (owned.has(entry.name)) continue;
                  const src = path.join(otherDir, entry.name);
                  const dst = path.join(stagedDir, entry.name);
                  if (entry.isSymbolicLink()) {
                    fs.symlinkSync(fs.readlinkSync(src), dst);
                  } else if (entry.isDirectory()) {
                    fs.cpSync(src, dst, { recursive: true, verbatimSymlinks: true });
                  } else {
                    fs.copyFileSync(src, dst);
                  }
                  sidecarCount++;
                }
              } else {
                console.warn(
                  `[forge.config] darwin-${otherArch} llama-server not found at ${otherDir} — ` +
                    'universal file-set check will likely fail. ' +
                    `Run: cross-env TARGET_PLATFORM=darwin TARGET_ARCH=${otherArch} node scripts/fetch-llama-binaries.js`
                );
              }
              console.log(
                `[forge.config] staged darwin-${arch} llama-server + ${sidecarCount} sidecar entries from ${otherArch}`
              );
            }
          } else if (path.resolve(correctDir) !== path.resolve(llamaBinaryDir)) {
            const stagedDir = findStagedLlamaServerDir(stagingPath);
            if (!stagedDir) {
              console.warn(
                `[forge.config] could not locate staged llama-server dir under ${stagingPath} to fix up for ${platform}-${arch}`
              );
            } else {
              fs.rmSync(stagedDir, { recursive: true, force: true });
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
