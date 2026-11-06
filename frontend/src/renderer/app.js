import '@xterm/xterm/css/xterm.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles.css';

import { Workspace } from './workspace.js';
import { Palette } from './palette.js';
import { SettingsPanel } from './settings-panel.js';
import { applyChrome, searchDecorations } from './theme.js';
import { h, icon, clamp, ensureFont } from './util.js';

const api = window.cmder;

async function main() {
  const init = await api.init();

  // Shared state every module reads from.
  const ctx = {
    settings: init.settings,
    themes: init.themes,
    profiles: init.profiles,
    cmderRoot: init.cmderRoot,
    home: init.home,
    windowsBuild: init.windowsBuild,
    theme: null,
    workspace: null,
    palette: null,
    settingsPanel: null,
    search: null,
    ptyPanes: new Map(),

    registerPty(pane) { ctx.ptyPanes.set(pane.ptyId, pane); },
    unregisterPty(pane) { if (pane.ptyId) ctx.ptyPanes.delete(pane.ptyId); },
    onPaneChanged() { ctx.workspace?.scheduleBar(); },
    onPaneFocused(pane) { ctx.workspace?.onPaneFocused(pane); },
    onActiveChanged() { ctx.search?.onActiveChanged(); },
    closePane(pane) { ctx.workspace.closePane(pane); },
    updateSettings(patch) { return api.settings.update(patch); },
    // Requests a shell sends with OSC 7337 (the `/settings` command and friends).
    onShellRequest(_pane, request) {
      if (request === 'settings') ctx.settingsPanel.open();
      else if (request === 'palette' || request === 'new') ctx.palette.open();
      else if (request.startsWith('theme=')) {
        const id = request.slice(6).toLowerCase();
        const t = ctx.themes.find((x) => x.id === id || x.name.toLowerCase() === id);
        if (t) ctx.updateSettings({ theme: t.id });
        else ctx.toast(`No theme called "${id}"`);
      }
    },
    toast,
    confirm: confirmDialog,
  };
  ctx.theme = resolveTheme(ctx);
  if (init.dev) window.__cmder = ctx; // inspection hook for `npm run dev`

  await Promise.all([ensureFont('JetBrains Mono Variable'), ensureFont('Inter Variable', [400, 500, 600])]);
  await ensureFont(ctx.settings.fontFamily, [ctx.settings.fontWeight, ctx.settings.fontWeightBold]);
  applyChrome(ctx.theme, ctx.settings);

  const stage = document.getElementById('stage');
  const tabBar = document.getElementById('tabs');
  ctx.workspace = new Workspace(ctx, { stage, tabBar });
  ctx.palette = new Palette(ctx);
  ctx.settingsPanel = new SettingsPanel(ctx);
  ctx.search = new SearchBox(ctx, stage);
  setupWindowControls();

  // ---------------------------------------------------------------- main process events

  api.pty.onData((id, data) => {
    const pane = ctx.ptyPanes.get(id);
    if (!pane) return;
    pane.term.write(data);
    ctx.workspace.markActivity(pane);
  });
  api.pty.onExit((id, code) => {
    const pane = ctx.ptyPanes.get(id);
    if (!pane) return;
    ctx.ptyPanes.delete(id);
    // A clean `exit` closes the pane; anything else stays so the error can be read.
    if (code === 0) ctx.workspace.closePane(pane);
    else pane.markExited(code);
  });

  api.settings.onChange(async (values) => {
    const prev = ctx.settings;
    ctx.settings = values;
    ctx.theme = resolveTheme(ctx);
    if (values.fontFamily !== prev.fontFamily || values.fontWeight !== prev.fontWeight
      || values.fontWeightBold !== prev.fontWeightBold) {
      await ensureFont(values.fontFamily, [values.fontWeight, values.fontWeightBold]);
    }
    applyChrome(ctx.theme, values);
    for (const pane of ctx.workspace.allPanes()) pane.applySettings();
    ctx.settingsPanel.refresh();
    ctx.search.onActiveChanged();
  });
  api.settings.onError((message) => toast(message, 6000));
  api.profiles.onChange((profiles) => { ctx.profiles = profiles; });
  if (init.settingsError) toast(init.settingsError, 6000);

  // ---------------------------------------------------------------- input

  setupShortcuts(ctx);
  setupAltHint();
  setupDrop(ctx);

  window.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    zoom(ctx, e.deltaY < 0 ? 1 : -1);
  }, { passive: false, capture: true });

  window.addEventListener('focus', () => {
    if (!ctx.palette.isOpen && !ctx.settingsPanel.isOpen && !ctx.search.isOpen && !ctx.workspace.renaming) {
      ctx.workspace.focusActive();
    }
  });

  await ctx.workspace.newTab(ctx.settings.defaultProfile);
}

function resolveTheme(ctx) {
  return ctx.themes.find((t) => t.id === ctx.settings.theme) || ctx.themes[0];
}

function zoom(ctx, delta) {
  const size = delta === 0 ? 14 : clamp(ctx.settings.fontSize + delta, 8, 36);
  if (size !== ctx.settings.fontSize) ctx.updateSettings({ fontSize: size });
}

// ------------------------------------------------------------------ shortcuts

function comboOf(e) {
  let key = e.key;
  if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad\d$/.test(e.code)) key = e.code.slice(6);
  else if (key.length === 1) key = key.toLowerCase();
  if (key === '+') key = '=';
  return [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', key].filter(Boolean).join('+');
}

function setupShortcuts(ctx) {
  const ws = ctx.workspace;
  const pane = () => ws.activePane;
  const profileAt = (i) => ctx.profiles.filter((p) => p.available)[i];

  const bindings = {
    'Ctrl+t': () => ctx.palette.toggle(),
    'Ctrl+Shift+t': () => ws.newTab(),
    'Ctrl+w': () => ws.closeFocusedPane(),
    'Ctrl+Tab': () => ws.cycle(1),
    'Ctrl+Shift+Tab': () => ws.cycle(-1),
    'Ctrl+PageDown': () => ws.cycle(1),
    'Ctrl+PageUp': () => ws.cycle(-1),
    'Ctrl+Shift+PageDown': () => ws.moveActive(1),
    'Ctrl+Shift+PageUp': () => ws.moveActive(-1),
    'Ctrl+Shift+e': () => ws.split('row'),
    'Ctrl+Shift+o': () => ws.split('column'),
    'Alt+ArrowLeft': () => ws.focusDirection('left'),
    'Alt+ArrowRight': () => ws.focusDirection('right'),
    'Alt+ArrowUp': () => ws.focusDirection('up'),
    'Alt+ArrowDown': () => ws.focusDirection('down'),
    'Ctrl+,': () => ctx.settingsPanel.toggle(),
    F2: () => ws.renameActive(),
    'Ctrl+Shift+f': () => ctx.search.open(),
    F11: () => api.win.toggleFullscreen(),
    'Alt+Enter': () => api.win.toggleFullscreen(),
    'Ctrl+=': () => zoom(ctx, 1),
    'Ctrl+Shift+=': () => zoom(ctx, 1),
    'Ctrl+-': () => zoom(ctx, -1),
    'Ctrl+0': () => zoom(ctx, 0),
    'Ctrl+c': () => pane()?.copySelection() || false, // no selection: send ^C to the shell
    'Ctrl+Shift+c': () => { pane()?.copySelection(); },
    'Ctrl+Insert': () => { pane()?.copySelection(); },
    'Ctrl+v': () => { pane()?.paste(); },
    'Ctrl+Shift+v': () => { pane()?.paste(); },
    'Shift+Insert': () => { pane()?.paste(); },
    'Ctrl+Shift+i': () => api.win.devtools(),
  };
  for (let i = 1; i <= 9; i++) bindings[`Ctrl+${i}`] = () => ws.goto(i === 9 ? -1 : i - 1);
  for (let i = 1; i <= 4; i++) {
    bindings[`Shift+Alt+${i}`] = () => {
      const p = profileAt(i - 1);
      if (p) ws.newTab(p.id);
    };
  }
  // These still work while typing in the palette, settings or a tab name.
  const global = new Set(['Ctrl+t', 'Ctrl+,', 'Ctrl+Tab', 'Ctrl+Shift+Tab', 'F11']);

  window.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const combo = comboOf(e);
    if (combo === 'Escape' && !ctx.palette.isOpen && !ws.renaming) {
      const target = ctx.settingsPanel.isOpen ? ctx.settingsPanel : ctx.search.isOpen ? ctx.search : null;
      if (target) {
        e.preventDefault();
        e.stopPropagation();
        target.close();
        return;
      }
    }
    const fn = bindings[combo];
    if (!fn) return;
    const t = e.target;
    const inTerminal = t?.classList?.contains('xterm-helper-textarea');
    const editable = !inTerminal && (t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName || ''));
    if (editable && !global.has(combo)) return;
    if (ctx.palette.isOpen && combo !== 'Ctrl+t') ctx.palette.close();
    if (fn(e) === false) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

// Holding Alt highlights tabs as split targets.
function setupAltHint() {
  const set = (on) => document.body.classList.toggle('alt-held', on);
  window.addEventListener('keydown', (e) => { if (e.key === 'Alt') set(true); }, true);
  window.addEventListener('keyup', (e) => { if (e.key === 'Alt' || !e.altKey) set(false); }, true);
  window.addEventListener('blur', () => set(false));
  window.addEventListener('pointermove', (e) => { if (!e.altKey) set(false); }, { passive: true });
}

// Dropping files pastes their paths, quoted when needed.
function setupDrop(ctx) {
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    const paths = files.map((f) => api.pathForFile(f)).filter(Boolean)
      .map((p) => (/\s/.test(p) ? `"${p}"` : p));
    ctx.workspace.activePane?.paste(paths.join(' '));
  });
}

function setupWindowControls() {
  const max = h('button', { class: 'wc', title: 'Maximize', onclick: () => api.win.toggleMaximize() }, icon('maximize'));
  const controls = document.getElementById('win-controls');
  controls.append(
    h('button', { class: 'wc', title: 'Minimize', onclick: () => api.win.minimize() }, icon('minimize')),
    max,
    h('button', { class: 'wc close', title: 'Close', onclick: () => api.win.close() }, icon('close')));
  controls.addEventListener('mousedown', (e) => e.preventDefault());
  api.win.onState(({ maximized, fullscreen, focused }) => {
    max.replaceChildren(icon(maximized ? 'restore' : 'maximize'));
    max.title = maximized ? 'Restore' : 'Maximize';
    document.body.classList.toggle('fullscreen', fullscreen);
    document.body.classList.toggle('inactive', !focused);
  });
}

// ------------------------------------------------------------------ search

class SearchBox {
  constructor(ctx, stage) {
    this.ctx = ctx;
    this.input = h('input', { class: 'search-input', placeholder: 'Find', spellcheck: false });
    this.count = h('span', { class: 'search-count' });
    this.root = h('div', { class: 'search' },
      this.input,
      this.count,
      h('button', { class: 'icon-btn', title: 'Previous (Shift+Enter)', onclick: () => this.find(-1) }, icon('up')),
      h('button', { class: 'icon-btn', title: 'Next (Enter)', onclick: () => this.find(1) }, icon('down')),
      h('button', { class: 'icon-btn', title: 'Close (Esc)', onclick: () => this.close() }, icon('close')));
    stage.append(this.root);
    this.root.addEventListener('mousedown', (e) => {
      if (e.target !== this.input) e.preventDefault();
    });
    this.input.addEventListener('input', () => this.find(0));
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.find(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.pane = null;
    this.sub = null;
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  open() {
    const pane = this.ctx.workspace.activePane;
    if (!pane) return;
    this.attach(pane);
    this.root.classList.add('open');
    const sel = pane.term.getSelection();
    if (sel && !sel.includes('\n')) this.input.value = sel;
    this.input.focus();
    this.input.select();
    if (this.input.value) this.find(0);
  }

  attach(pane) {
    if (this.pane === pane) return;
    this.pane?.search.clearDecorations();
    this.sub?.dispose();
    this.pane = pane;
    this.sub = pane.search.onDidChangeResults(({ resultIndex, resultCount }) => {
      this.count.textContent = resultCount ? `${resultIndex + 1}/${resultCount}` : this.input.value ? '0/0' : '';
    });
  }

  find(dir) {
    if (!this.pane) return;
    const q = this.input.value;
    if (!q) {
      this.pane.search.clearDecorations();
      this.count.textContent = '';
      return;
    }
    const opts = { decorations: searchDecorations(this.ctx.theme), incremental: dir === 0 };
    if (dir < 0) this.pane.search.findPrevious(q, opts);
    else this.pane.search.findNext(q, opts);
  }

  onActiveChanged() {
    if (!this.isOpen) return;
    const pane = this.ctx.workspace.activePane;
    if (pane && pane !== this.pane) {
      this.attach(pane);
      this.find(0);
    }
  }

  close() {
    this.root.classList.remove('open');
    this.pane?.search.clearDecorations();
    this.count.textContent = '';
    this.ctx.workspace.focusActive();
  }
}

// ------------------------------------------------------------------ toast + confirm

let toastTimer = 0;
function toast(message, ms = 3200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', class: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function confirmDialog(message, okLabel = 'OK') {
  return new Promise((resolve) => {
    const done = (v) => {
      root.remove();
      resolve(v);
    };
    const ok = h('button', { class: 'btn primary', onclick: () => done(true) }, okLabel);
    const root = h('div', { class: 'overlay open confirm-overlay' },
      h('div', { class: 'backdrop', onclick: () => done(false) }),
      h('div', { class: 'confirm' },
        h('p', null, message),
        h('div', { class: 'confirm-actions' },
          h('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'),
          ok)));
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(false);
    });
    document.body.append(root);
    ok.focus();
  });
}

main().catch((err) => {
  document.body.append(h('pre', { class: 'fatal' }, `Cmder failed to start:\n${err.stack || err}`));
});
