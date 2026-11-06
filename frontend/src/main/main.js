'use strict';

const { app, BrowserWindow, ipcMain, clipboard, shell, Menu, session, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');
const { SettingsStore, StateStore, loadUserThemes } = require('./settings');
const { resolveCmderRoot, buildProfiles, shellEnv } = require('./profiles');
const { THEMES } = require('../shared/themes');

const DEV = process.argv.includes('--dev');
const APP_DIR = path.resolve(__dirname, '..', '..');
// The Cmder folder that hosts this app (frontend/ sits in the Cmder root).
const HOST_ROOT = path.resolve(APP_DIR, '..');
const CONFIG_DIR = process.env.CMDER_UI_CONFIG || path.join(HOST_ROOT, 'config');
const SETTINGS_FILE = path.join(CONFIG_DIR, 'user-ui.json');
const THEMES_DIR = path.join(CONFIG_DIR, 'themes');
const WINDOWS_BUILD = Number(os.release().split('.')[2]) || 0;

const settings = new SettingsStore(SETTINGS_FILE);
const windowState = new StateStore(path.join(CONFIG_DIR, 'user-ui-state.json'));

let win = null;
let cmderRoot = HOST_ROOT;
let profiles = [];
let userThemes = [];

function refreshEnvironment() {
  const s = settings.get();
  cmderRoot = resolveCmderRoot(s.cmderRoot, HOST_ROOT);
  profiles = buildProfiles(cmderRoot, s.profiles);
  userThemes = loadUserThemes(THEMES_DIR);
}

function allThemes() {
  const ids = new Set(userThemes.map((t) => t.id));
  return [...THEMES.filter((t) => !ids.has(t.id)), ...userThemes];
}

function themeBackground() {
  const id = settings.get().theme;
  return (allThemes().find((t) => t.id === id) || THEMES[0]).background;
}

function publicProfile(p) {
  return { id: p.id, name: p.name, short: p.short, description: p.description, available: p.available, user: !!p.user };
}

function send(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// ---------------------------------------------------------------- PTYs

const ptys = new Map();
let nextPtyId = 1;

function expandPath(p) {
  if (!p) return '';
  return p
    .replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m)
    .replace(/^~(?=$|[\\/])/, os.homedir());
}

function validDir(p) {
  if (!p) return null;
  try { return fs.statSync(p).isDirectory() ? p : null; } catch { return null; }
}

function flush(id) {
  const entry = ptys.get(id);
  if (!entry) return;
  entry.timer = null;
  if (entry.buf) {
    send('pty:data', id, entry.buf);
    entry.buf = '';
  }
}

function spawnPty({ profileId, cwd, cols, rows }) {
  const s = settings.get();
  const usable = profiles.filter((p) => p.available);
  const profile = usable.find((p) => p.id === profileId)
    || usable.find((p) => p.id === s.defaultProfile)
    || usable[0];
  if (!profile) throw new Error(`No shell found. Is "${cmderRoot}" a Cmder folder?`);

  const startDir = validDir(cwd) || validDir(expandPath(profile.cwd))
    || validDir(expandPath(s.startDirectory)) || os.homedir();

  const p = pty.spawn(profile.file, profile.args, {
    name: 'xterm-256color',
    cols: Math.max(2, cols | 0),
    rows: Math.max(1, rows | 0),
    cwd: startDir,
    env: shellEnv(cmderRoot, profile.env),
    useConpty: true,
    // Ship the same ConPTY build Windows Terminal uses: newer and passes escape codes through faithfully.
    useConptyDll: true,
  });

  const id = nextPtyId++;
  const entry = { p, buf: '', timer: null, closed: false };
  ptys.set(id, entry);
  // node-pty attaches no error handler to the shell's input pipe. A keystroke (or a
  // focus report) that races the shell's exit fails with EAGAIN ("pipe is being
  // closed"), which would surface as an uncaught exception. The shell is going away,
  // so just stop writing to it.
  p._agent?.inSocket?.on('error', () => { entry.closed = true; });
  // Coalesce chunks: one IPC message per few ms instead of hundreds while output floods.
  p.onData((d) => {
    entry.buf += d;
    if (!entry.timer) entry.timer = setTimeout(() => flush(id), 4);
  });
  p.onExit(({ exitCode }) => {
    entry.closed = true;
    flush(id);
    ptys.delete(id);
    send('pty:exit', id, exitCode);
  });
  return { id, profile: publicProfile(profile), cwd: startDir };
}

function killAll() {
  for (const { p } of ptys.values()) {
    try { p.kill(); } catch { /* already gone */ }
  }
  ptys.clear();
}

// ---------------------------------------------------------------- window

function restoredBounds() {
  const b = windowState.get('bounds');
  if (!b) return { width: 1100, height: 680 };
  const visible = screen.getAllDisplays().some(({ workArea: w }) =>
    b.x < w.x + w.width - 50 && b.x + b.width > w.x + 50 && b.y < w.y + w.height - 50 && b.y + b.height > w.y);
  return visible ? b : { width: b.width, height: b.height };
}

function sendWindowState() {
  if (!win || win.isDestroyed()) return;
  send('win:state', { maximized: win.isMaximized(), fullscreen: win.isFullScreen(), focused: win.isFocused() });
}

function createWindow() {
  win = new BrowserWindow({
    ...restoredBounds(),
    minWidth: 420,
    minHeight: 220,
    frame: false,
    show: false,
    title: 'Cmder',
    backgroundColor: themeBackground(),
    icon: path.join(HOST_ROOT, 'icons', 'cmder.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });

  if (windowState.get('maximized')) win.maximize();
  win.loadFile(path.join(APP_DIR, 'dist', 'index.html'));
  win.once('ready-to-show', () => win.show());

  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen', 'focus', 'blur']) {
    win.on(ev, sendWindowState);
  }

  win.on('close', () => {
    windowState.set('bounds', win.getNormalBounds());
    windowState.set('maximized', win.isMaximized());
  });
  win.on('closed', () => {
    killAll();
    win = null;
  });

  // A reload (dev) starts a fresh UI; don't leave the old shells running unattached.
  win.webContents.on('did-start-loading', killAll);

  // The UI is a local page: never navigate it, open web links in the browser.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Terminal zoom is font size, not page zoom.
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on('zoom-changed', () => win.webContents.setZoomFactor(1));
}

// ---------------------------------------------------------------- IPC

function initPayload() {
  return {
    settings: settings.get(),
    settingsError: settings.error,
    themes: allThemes(),
    profiles: profiles.map(publicProfile),
    cmderRoot,
    home: os.homedir(),
    configDir: CONFIG_DIR,
    settingsFile: SETTINGS_FILE,
    windowsBuild: WINDOWS_BUILD,
    dev: DEV,
  };
}

function registerIpc() {
  ipcMain.handle('app:init', () => initPayload());

  ipcMain.handle('settings:update', (_e, patch) => {
    settings.update(patch);
    return settings.get();
  });
  ipcMain.handle('settings:reset', () => {
    settings.reset();
    return settings.get();
  });
  ipcMain.handle('settings:openFile', () => {
    settings.saveNow();
    return shell.openPath(SETTINGS_FILE);
  });
  ipcMain.handle('themes:reload', () => {
    userThemes = loadUserThemes(THEMES_DIR);
    return allThemes();
  });
  ipcMain.handle('themes:openFolder', () => {
    fs.mkdirSync(THEMES_DIR, { recursive: true });
    return shell.openPath(THEMES_DIR);
  });

  ipcMain.handle('pty:spawn', (_e, opts) => {
    try {
      return { ok: true, ...spawnPty(opts) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.on('pty:write', (_e, id, data) => {
    const entry = ptys.get(id);
    if (!entry || entry.closed) return;
    try { entry.p.write(data); } catch { entry.closed = true; }
  });
  ipcMain.on('pty:resize', (_e, id, cols, rows) => {
    const entry = ptys.get(id);
    if (!entry || cols < 2 || rows < 1) return;
    try { entry.p.resize(cols, rows); } catch { /* exited mid-resize */ }
  });
  ipcMain.on('pty:kill', (_e, id) => {
    const entry = ptys.get(id);
    if (entry) {
      try { entry.p.kill(); } catch { /* already gone */ }
    }
  });

  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text ?? '')));
  ipcMain.on('shell:openExternal', (_e, url) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.on('win:minimize', () => win?.minimize());
  ipcMain.on('win:toggleMaximize', () => {
    if (!win) return;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
  });
  ipcMain.on('win:toggleFullscreen', () => win?.setFullScreen(!win.isFullScreen()));
  ipcMain.on('win:close', () => win?.close());
  ipcMain.on('win:devtools', () => {
    if (DEV) win?.webContents.toggleDevTools();
  });
}

// ---------------------------------------------------------------- app

// Last line of defense: a pipe closing under a shell that is exiting is not worth a
// crash dialog. Anything else still surfaces.
const PIPE_GONE = new Set(['EAGAIN', 'EPIPE', 'EIO', 'ECONNRESET', 'ERR_STREAM_DESTROYED', 'ERR_STREAM_WRITE_AFTER_END']);
process.on('uncaughtException', (err) => {
  if (PIPE_GONE.has(err?.code)) {
    console.warn(`[pty] ignored ${err.code}: ${err.message}`);
    return;
  }
  console.error(err);
  dialog.showErrorBox('Cmder', err?.stack || String(err));
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'local-fonts', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  refreshEnvironment();
  registerIpc();

  settings.on('change', (values) => {
    refreshEnvironment();
    send('settings:changed', values);
    send('profiles:changed', profiles.map(publicProfile));
    win?.setBackgroundColor(themeBackground());
  });
  settings.on('error', (message) => send('settings:error', message));
  settings.watch();

  createWindow();
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => {
  settings.saveNow();
  killAll();
});
