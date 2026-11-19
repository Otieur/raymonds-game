/**
 * Assembles the macOS app from the copy of the game that `vite build --mode app` writes to
 * build/site. Run both steps with `npm run app`, or `npm run app:install` to also put a copy
 * in /Applications.
 *
 * The app is a launcher and nothing more: a shell script that opens the game it carries in
 * Google Chrome, as a window of its own, and exits. The game runs from disk; nothing is
 * served and nothing keeps running.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The name shown in Finder, Launchpad and the Dock. */
const DISPLAY_NAME = 'The Romance of Three Kingdoms: Tycoon';
/** The bundle's name on disk. Finder cannot show a colon in a file name, so this has none. */
const FILE_NAME = 'The Romance of Three Kingdoms Tycoon';
/** Names earlier versions of this script gave the app; copies under them are cleared away. */
const EARLIER_NAMES = ['三国'];
const IDENTIFIER = 'local.three-kingdoms.launcher';

const root = fileURLToPath(new URL('..', import.meta.url));
const site = join(root, 'build', 'site');
const app = join(root, 'build', `${FILE_NAME}.app`);
const artwork = join(root, 'assets', 'app', 'icon.png');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };

if (process.platform !== 'darwin') throw new Error('The app is a macOS bundle and can only be assembled on a Mac.');
if (!existsSync(join(site, 'index.html'))) throw new Error('build/site is missing. Run `npm run app`, which builds it first.');

/** Whether the bundle at `path` is a copy of this app, whatever it is called. */
function isOurs(path: string): boolean {
  const plist = join(path, 'Contents', 'Info.plist');
  return existsSync(plist) && readFileSync(plist, 'utf8').includes(IDENTIFIER);
}

/** Removes copies of this app left in `folder` under a name it no longer uses. */
function clearEarlierCopies(folder: string): void {
  for (const name of EARLIER_NAMES) {
    const old = join(folder, `${name}.app`);
    if (existsSync(old) && isOurs(old)) {
      rmSync(old, { recursive: true, force: true });
      console.log(`Removed ${old}`);
    }
  }
}

const contents = join(app, 'Contents');
const resources = join(contents, 'Resources');
clearEarlierCopies(join(root, 'build'));
rmSync(app, { recursive: true, force: true });
mkdirSync(join(contents, 'MacOS'), { recursive: true });
mkdirSync(resources, { recursive: true });

cpSync(site, join(resources, 'site'), { recursive: true });

// The icon, at every size macOS asks for.
const iconset = join(root, 'build', 'icon.iconset');
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });
for (const points of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = String(points * scale);
    const file = `icon_${points}x${points}${scale === 2 ? '@2x' : ''}.png`;
    execFileSync('/usr/bin/sips', ['-z', pixels, pixels, artwork, '--out', join(iconset, file)], { stdio: 'ignore' });
  }
}
execFileSync('/usr/bin/iconutil', ['-c', 'icns', '-o', join(resources, 'icon.icns'), iconset]);
rmSync(iconset, { recursive: true, force: true });

writeFileSync(
  join(contents, 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${FILE_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${FILE_NAME}</string>
  <key>LSHasLocalizedDisplayName</key>
  <true/>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleIdentifier</key>
  <string>${IDENTIFIER}</string>
  <key>CFBundleVersion</key>
  <string>${version}</string>
  <key>CFBundleShortVersionString</key>
  <string>${version}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>LSMinimumSystemVersion</key>
  <string>11.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`,
);

// macOS shows the display name, colon and all, only as a localized name. Finder uses it while
// the bundle's file name still matches CFBundleDisplayName in Info.plist, which is why that key
// holds the file name; rename the bundle and Finder shows the new file name instead.
for (const language of ['en', 'zh-Hans', 'zh-Hant']) {
  const folder = join(resources, `${language}.lproj`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, 'InfoPlist.strings'),
    `"CFBundleDisplayName" = "${DISPLAY_NAME}";\n"CFBundleName" = "${DISPLAY_NAME}";\n`,
  );
}

// The launcher. It percent-encodes the page's path byte by byte (slashes apart), so the app
// works from a folder with spaces or non-Latin characters in its name.
const launcher = join(contents, 'MacOS', 'launcher');
writeFileSync(
  launcher,
  `#!/bin/sh
# Opens the game carried inside this app in Google Chrome, as a window of its own.
site=$(cd "$(dirname "$0")/../Resources/site" && pwd) || exit 1
page="$site/index.html"
encoded=$(printf '%s' "$page" | /usr/bin/od -An -v -tx1 | /usr/bin/tr -d ' \\n' | /usr/bin/sed -e 's/\\(..\\)/%\\1/g' -e 's/%2[fF]/\\//g')

if /usr/bin/open -Ra "Google Chrome" 2>/dev/null; then
  exec /usr/bin/open -na "Google Chrome" --args --app="file://$encoded"
fi
# Without Chrome, whatever browser opens web pages on this Mac.
exec /usr/bin/open "$page"
`,
);
chmodSync(launcher, 0o755);

// A fresh modification time makes Finder pick up the new icon.
const now = new Date();
utimesSync(app, now, now);

console.log(`Built ${app}`);

// With --install, a copy also goes where Launchpad and Spotlight look for apps. An app of the
// same name is replaced only if it is an earlier copy of this one.
if (process.argv.includes('--install')) {
  const installed = join('/Applications', `${FILE_NAME}.app`);
  if (existsSync(installed) && !isOurs(installed)) {
    throw new Error(`${installed} exists and is a different app. It was left alone.`);
  }
  clearEarlierCopies('/Applications');
  rmSync(installed, { recursive: true, force: true });
  cpSync(app, installed, { recursive: true });
  utimesSync(installed, now, now);
  console.log(`Installed ${installed}`);
}
