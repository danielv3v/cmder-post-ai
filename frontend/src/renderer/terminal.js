import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { h, basename, fileUrlToPath, fontStack } from './util.js';
import { xtermTheme } from './theme.js';

let paneSeq = 0;

// Private OSC number the shell hooks use to talk to the window (e.g. `/settings`).
export const CMDER_OSC = 7337;

function termOptions(ctx) {
  const s = ctx.settings;
  return {
    fontFamily: fontStack(s.fontFamily, 'mono'),
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    fontWeightBold: s.fontWeightBold,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    cursorStyle: s.cursorStyle,
    cursorBlink: s.cursorBlink,
    cursorInactiveStyle: 'outline',
    scrollback: s.scrollback,
    theme: xtermTheme(ctx.theme),
  };
}

// One shell: an xterm instance wired to a ConPTY process in the main process.
export class Pane {
  constructor(ctx, { profileId, cwd }) {
    this.id = ++paneSeq;
    this.ctx = ctx;
    this.profileId = profileId;
    this.profile = ctx.profiles.find((p) => p.id === profileId) || null;
    this.ptyId = null;
    this.cwd = cwd || null;
    this.title = '';
    this.exited = false;
    this.opened = false;
    this.webgl = null;
    this._fitFrame = 0;

    this.host = h('div', { class: 'term-host' });
    this.el = h('div', { class: 'pane', dataset: { pane: this.id } }, this.host);

    this.term = new Terminal({
      ...termOptions(ctx),
      allowProposedApi: true,
      windowsPty: { backend: 'conpty', buildNumber: ctx.windowsBuild },
      smoothScrollDuration: 0,
      fastScrollSensitivity: 5,
    });
    this.fitAddon = new FitAddon();
    this.search = new SearchAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(this.search);
    this.term.loadAddon(new Unicode11Addon());
    this.term.unicode.activeVersion = '11';
    this.term.loadAddon(new WebLinksAddon((event, uri) => {
      if (event.ctrlKey) window.cmder.openExternal(uri);
    }));

    this._wireTerminal();
    this.resizeObserver = new ResizeObserver(() => this.scheduleFit());
  }

  _wireTerminal() {
    const { term, ctx } = this;
    const parser = term.parser;

    // OSC 9;9 (cmd/Clink, PowerShell) and OSC 7 (bash) report the working directory.
    parser.registerOscHandler(9, (data) => {
      if (!data.startsWith('9;')) return false;
      this.setCwd(data.slice(2).trim().replace(/^"(.*)"$/, '$1'));
      return true;
    });
    parser.registerOscHandler(7, (data) => {
      const p = fileUrlToPath(data);
      if (p) this.setCwd(p);
      return true;
    });
    parser.registerOscHandler(CMDER_OSC, (data) => {
      ctx.onShellRequest(this, data.trim());
      return true;
    });

    term.onTitleChange((t) => {
      this.title = t;
      ctx.onPaneChanged(this);
    });
    term.onData((d) => {
      if (this.exited) {
        ctx.closePane(this);
        return;
      }
      if (this.ptyId) window.cmder.pty.write(this.ptyId, d);
    });
    term.onBinary((d) => {
      if (this.ptyId && !this.exited) window.cmder.pty.write(this.ptyId, d);
    });
    term.onResize(({ cols, rows }) => {
      if (this.ptyId && !this.exited) window.cmder.pty.resize(this.ptyId, cols, rows);
    });
    term.onSelectionChange(() => {
      if (ctx.settings.copyOnSelect && term.hasSelection()) {
        window.cmder.clipboard.write(term.getSelection());
      }
    });
    this.el.addEventListener('mousedown', () => ctx.onPaneFocused(this), true);
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!ctx.settings.rightClickPaste) return;
      if (term.hasSelection()) {
        window.cmder.clipboard.write(term.getSelection());
        term.clearSelection();
      } else {
        this.paste();
      }
    });
  }

  open() {
    if (this.opened) return;
    this.term.open(this.host);
    this.opened = true;
    // The textarea only exists once the terminal is opened.
    this.term.textarea?.addEventListener('focus', () => this.ctx.onPaneFocused(this));
    this.setGpu(this.ctx.settings.gpuAcceleration);
    this.resizeObserver.observe(this.el);
    this.fit();
  }

  async start() {
    this.fit();
    const res = await window.cmder.pty.spawn({
      profileId: this.profileId,
      cwd: this.cwd,
      cols: this.term.cols,
      rows: this.term.rows,
    });
    if (!res.ok) {
      this.exited = true;
      this.term.write(`\x1b[31m${res.error}\x1b[0m\r\n\x1b[2mPress any key to close.\x1b[0m`);
      return;
    }
    this.ptyId = res.id;
    this.profile = res.profile;
    this.profileId = res.profile.id;
    if (!this.cwd) this.cwd = res.cwd;
    this.ctx.registerPty(this);
    this.ctx.onPaneChanged(this);
    // Size may have changed while the shell was starting.
    window.cmder.pty.resize(this.ptyId, this.term.cols, this.term.rows);
  }

  setGpu(enabled) {
    if (!this.opened) return;
    if (enabled && !this.webgl) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
          if (this.webgl === webgl) this.webgl = null;
        });
        this.term.loadAddon(webgl);
        this.webgl = webgl;
      } catch {
        this.webgl = null; // falls back to the DOM renderer
      }
    } else if (!enabled && this.webgl) {
      this.webgl.dispose();
      this.webgl = null;
    }
  }

  applySettings() {
    const opts = termOptions(this.ctx);
    for (const [k, v] of Object.entries(opts)) {
      if (k === 'theme' || this.term.options[k] !== v) this.term.options[k] = v;
    }
    this.setGpu(this.ctx.settings.gpuAcceleration);
    this.scheduleFit();
  }

  scheduleFit() {
    if (this._fitFrame) return;
    this._fitFrame = requestAnimationFrame(() => {
      this._fitFrame = 0;
      this.fit();
    });
  }

  fit() {
    if (!this.opened || !this.el.isConnected) return;
    if (this.el.clientWidth < 10 || this.el.clientHeight < 10) return;
    const dims = this.fitAddon.proposeDimensions();
    if (!dims || !Number.isFinite(dims.cols) || !Number.isFinite(dims.rows)) return;
    const cols = Math.max(2, dims.cols);
    const rows = Math.max(1, dims.rows);
    if (cols !== this.term.cols || rows !== this.term.rows) this.term.resize(cols, rows);
  }

  setCwd(p) {
    if (!p || p === this.cwd) return;
    this.cwd = p;
    this.ctx.onPaneChanged(this);
  }

  label() {
    const home = this.ctx.home;
    if (this.cwd) {
      if (home && this.cwd.replace(/[\\/]+$/, '').toLowerCase() === home.toLowerCase()) return '~';
      return basename(this.cwd);
    }
    if (this.title && !/\.exe\b/i.test(this.title)) return this.title;
    return this.profile?.short || this.profile?.name || 'shell';
  }

  async paste(text) {
    const value = text ?? (await window.cmder.clipboard.read());
    if (value) this.term.paste(value);
    this.term.focus();
  }

  copySelection() {
    if (!this.term.hasSelection()) return false;
    window.cmder.clipboard.write(this.term.getSelection());
    this.term.clearSelection();
    return true;
  }

  focus() {
    if (this.opened) this.term.focus();
  }

  markExited(code) {
    this.exited = true;
    this.ptyId = null;
    this.term.options.cursorBlink = false;
    this.term.write(`\r\n\x1b[2m[process exited with code ${code}. Press any key to close]\x1b[0m`);
  }

  dispose() {
    cancelAnimationFrame(this._fitFrame);
    this.resizeObserver.disconnect();
    if (this.ptyId && !this.exited) window.cmder.pty.kill(this.ptyId);
    this.ptyId = null;
    this.exited = true;
    try { this.webgl?.dispose(); } catch { /* context already gone */ }
    this.term.dispose();
    this.el.remove();
  }
}
