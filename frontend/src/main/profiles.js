'use strict';

// Shell profiles: how each kind of Cmder tab is started.
// Commands mirror the tasks in vendor/ConEmu.xml.default so that a tab here
// behaves exactly like the matching ConEmu task.

const fs = require('fs');
const path = require('path');

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function isCmderRoot(dir) {
  return !!dir && exists(path.join(dir, 'vendor', 'init.bat'));
}

// Pick the Cmder installation whose scripts the shells should load.
// Order: explicit setting, CMDER_ROOT from the environment, the folder that hosts this app.
function resolveCmderRoot(settingValue, hostRoot) {
  const candidates = [settingValue, process.env.CMDER_ROOT, hostRoot];
  for (const c of candidates) {
    if (c && isCmderRoot(c)) return path.resolve(c);
  }
  return path.resolve(hostRoot);
}

function findOnPath(exe) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d.replace(/"/g, ''), exe);
    if (exists(p)) return p;
  }
  return null;
}

function findPwsh() {
  const programFiles = [process.env.ProgramFiles, process.env['ProgramW6432']].filter(Boolean);
  for (const pf of programFiles) {
    for (const v of ['7', '7-preview']) {
      const p = path.join(pf, 'PowerShell', v, 'pwsh.exe');
      if (exists(p)) return p;
    }
  }
  return findOnPath('pwsh.exe');
}

function buildProfiles(cmderRoot, userProfiles = []) {
  const vendor = path.join(cmderRoot, 'vendor');
  const sysRoot = process.env.SystemRoot || 'C:\\Windows';
  const cmdExe = process.env.ComSpec || path.join(sysRoot, 'System32', 'cmd.exe');
  const powershellExe = path.join(sysRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const pwshExe = findPwsh();
  const vendoredBash = path.join(vendor, 'git-for-windows', 'bin', 'bash.exe');
  const systemBash = path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe');
  const bashExe = exists(vendoredBash) ? vendoredBash : systemBash;
  const psProfile = path.join(vendor, 'profile.ps1');
  const psArgs = `-ExecutionPolicy Bypass -NoLogo -NoProfile -NoExit -Command "Invoke-Expression 'Import-Module ''${psProfile}'''"`;

  const profiles = [
    {
      id: 'cmder',
      name: 'Cmder',
      short: 'cmd',
      description: 'cmd.exe with Clink and Cmder aliases',
      file: cmdExe,
      // Raw command line: cmd.exe has its own quoting rules, so node-pty must not re-quote it.
      args: `/s /k ""${path.join(vendor, 'init.bat')}""`,
      env: {
        // Clink prints this before every prompt: OSC 9;9 reports the folder so splits open there.
        CLINK_PROMPT_PREFIX: '$e]9;9;$p$e\\',
      },
      available: exists(path.join(vendor, 'init.bat')),
    },
    {
      id: 'powershell',
      name: 'PowerShell',
      short: 'ps',
      description: 'Windows PowerShell with the Cmder profile',
      file: powershellExe,
      args: psArgs,
      available: exists(powershellExe),
    },
    {
      id: 'pwsh',
      name: 'PowerShell 7',
      short: 'pwsh',
      description: 'pwsh with the Cmder profile',
      file: pwshExe || 'pwsh.exe',
      args: psArgs,
      available: !!pwshExe,
    },
    {
      id: 'bash',
      name: 'Bash',
      short: 'bash',
      description: 'Git for Windows bash, login shell',
      file: bashExe,
      args: ['--login', '-i'],
      env: {
        CHERE_INVOKING: '1',
        TERM: 'xterm-256color',
        // Report the working directory (OSC 7) so splits open in the same folder.
        PROMPT_COMMAND: String.raw`printf '\033]7;file://%s%s\033\134' "$HOSTNAME" "$PWD"`,
      },
      available: exists(bashExe),
    },
  ];

  for (const p of userProfiles || []) {
    if (!p || !p.name || !p.command) continue;
    profiles.push({
      id: p.id || `user:${p.name}`,
      name: p.name,
      short: p.short || p.name.toLowerCase().split(/\s+/)[0],
      description: p.description || p.command,
      file: p.command,
      args: p.args ?? [],
      env: p.env || {},
      cwd: p.cwd,
      available: true,
      user: true,
    });
  }
  return profiles;
}

// Variables a parent Cmder/ConEmu/Windows Terminal session leaves behind.
// If they leak into our shells, init.bat thinks it is already configured.
const INHERITED_VARS = [
  /^ConEmu/i, /^WT_SESSION$/i, /^WT_PROFILE_ID$/i, /^ELECTRON_/i,
  /^CMDER_(ROOT|USER_FLAGS|ALIASES|CLINK|CONFIGURED|CONFIG_DIR|INIT_START|INIT_END|SHELL)$/i,
  /^GIT_INSTALL_(ROOT|TYPE)$/i, /^SVN_SSH$/i, /^PLINK_PROTOCOL$/i, /^git_locale$/i,
  /^PROMPT$/i, /^TERM_PROGRAM(_VERSION)?$/i,
];

function shellEnv(cmderRoot, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (INHERITED_VARS.some((re) => re.test(k))) continue;
    env[k] = v;
  }
  return {
    ...env,
    CMDER_ROOT: cmderRoot,
    CMDER_UI: '1',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'cmder',
    ...extra,
  };
}

module.exports = { resolveCmderRoot, buildProfiles, shellEnv, isCmderRoot };
