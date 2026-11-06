// Builds a standalone Cmder.exe into release/Cmder-win32-x64/.
// The exe finds its Cmder folder by walking up from where it lives, so it works
// from release/ or copied anywhere inside a Cmder folder (e.g. vendor/cmder-ui).
import { packager } from '@electron/packager';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

// Paths are relative to this folder and start with "/". Only the main process,
// the bundled UI in dist/ and node-pty's Windows x64 binaries are needed at runtime.
const ignore = [
  /^\/(src\/renderer|release|\.vscode)(\/|$)/,
  /^\/(build|package)\.mjs$/,
  /^\/README\.md$/,
  /^\/dist\/.*\.map$/,
  // The UI is bundled into dist/; at runtime only node-pty is loaded from node_modules.
  /^\/node_modules\/(?!node-pty(\/|$))/,
  /^\/node_modules\/node-pty\/(src|deps|third_party|scripts|typings)(\/|$)/,
  /^\/node_modules\/node-pty\/prebuilds\/(?!win32-x64)/,
  /^\/node_modules\/node-pty\/.*\.pdb$/,
];

const options = {
  dir: '.',
  out: 'release',
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  name: 'Cmder',
  executableName: 'Cmder',
  appVersion: pkg.version,
  icon: path.resolve('..', 'icons', 'cmder.ico'),
  asar: false, // node-pty starts OpenConsole.exe from its own folder; keep files on disk
  prune: false, // handled by the ignore list above
  ignore,
  win32metadata: {
    CompanyName: 'Cmder',
    FileDescription: 'Cmder',
    ProductName: 'Cmder',
    InternalName: 'Cmder',
    OriginalFilename: 'Cmder.exe',
  },
};

// Antivirus scanning a freshly built 200 MB exe can briefly lock it, which makes
// overwriting the previous build fail. Give it a moment and try once more.
async function build() {
  try {
    return await packager(options);
  } catch (err) {
    if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(err.code)) throw err;
    console.warn(`${err.code} while replacing the previous build, retrying in 3s...`);
    await new Promise((r) => setTimeout(r, 3000));
    return packager(options);
  }
}

const [appPath] = await build();

// Chromium ships UI strings for 50+ languages (~48 MB); the app shows none of them.
const locales = path.join(appPath, 'locales');
for (const f of readdirSync(locales)) {
  if (f !== 'en-US.pak') rmSync(path.join(locales, f));
}

console.log(`Packaged: ${path.join(appPath, 'Cmder.exe')}`);
