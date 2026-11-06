import { h, icon, clamp } from './util.js';

// Settings drawer. It slides over the right edge so the terminal stays visible
// and every change previews live. Values are saved to config/user-ui.json.

const WEIGHTS = [
  [100, 'Thin'], [200, 'Extra light'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'],
  [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black'],
];
const BUNDLED_MONO = 'JetBrains Mono Variable';
const BUNDLED_UI = 'Inter Variable';
const FALLBACK_MONO = ['Cascadia Mono', 'Cascadia Code', 'Consolas', 'Lucida Console', 'Courier New'];
const FALLBACK_UI = ['Segoe UI Variable Text', 'Segoe UI', 'Arial', 'Tahoma', 'Verdana'];
const OTHER = '__other__';

export class SettingsPanel {
  constructor(ctx) {
    this.ctx = ctx;
    this.controls = [];
    this.fonts = { mono: [BUNDLED_MONO, ...FALLBACK_MONO], all: [BUNDLED_UI, ...FALLBACK_UI] };
    this._fontsLoaded = false;

    this.themeGrid = h('div', { class: 'theme-grid' });
    this.body = h('div', { class: 'drawer-body' });
    this.root = h('aside', { class: 'drawer', tabIndex: -1, 'aria-label': 'Settings' },
      h('header', { class: 'drawer-head' },
        h('span', { class: 'drawer-title' }, 'Settings'),
        h('button', { class: 'icon-btn', title: 'Close (Esc)', onclick: () => this.close() }, icon('close'))),
      this.body,
      h('footer', { class: 'drawer-foot' },
        h('button', { class: 'btn', onclick: () => window.cmder.settings.openFile() }, 'Edit JSON'),
        h('button', { class: 'btn', onclick: () => window.cmder.themes.openFolder() }, 'Themes folder'),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn danger', onclick: () => this.confirmReset() }, 'Reset')));
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    document.body.append(this.root);
    this.build();
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  async open() {
    this.root.classList.add('open');
    this.refresh();
    this.root.focus({ preventScroll: true });
    this.ctx.themes = await window.cmder.themes.reload();
    this.renderThemes();
    this.loadFonts();
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('open');
    this.ctx.workspace.focusActive();
  }

  set(patch) {
    return this.ctx.updateSettings(patch);
  }

  // ------------------------------------------------------------ build

  build() {
    const section = (title, ...rows) => h('section', { class: 'section' }, h('h3', null, title), ...rows);
    const row = (label, control, note) => h('div', { class: 'setting-row' },
      h('div', { class: 'setting-text' }, h('label', null, label), note ? h('small', null, note) : null),
      control);

    this.body.append(
      section('Theme', this.themeGrid),
      section('Text',
        row('Font', this.fontSelect('fontFamily', 'mono')),
        row('Size', this.stepper('fontSize', { min: 8, max: 36, step: 1, unit: 'px' })),
        row('Weight', this.select('fontWeight', WEIGHTS, true)),
        row('Bold weight', this.select('fontWeightBold', WEIGHTS, true)),
        row('Line height', this.range('lineHeight', { min: 1, max: 2, step: 0.05, format: (v) => v.toFixed(2) })),
        row('Letter spacing', this.stepper('letterSpacing', { min: -2, max: 8, step: 1, unit: 'px' }))),
      section('Cursor',
        row('Style', this.segmented('cursorStyle', [['bar', 'Bar'], ['block', 'Block'], ['underline', 'Line']])),
        row('Blink', this.switchControl('cursorBlink'))),
      section('Window',
        row('Interface font', this.fontSelect('uiFontFamily', 'ui')),
        row('Interface size', this.stepper('uiFontSize', { min: 10, max: 16, step: 1, unit: 'px' })),
        row('Padding', this.range('padding', { min: 0, max: 28, step: 1, format: (v) => `${v}px` }))),
      section('Shells',
        row('Default shell', this.profileSelect()),
        row('Start in', this.text('startDirectory', { placeholder: '%USERPROFILE%' }), 'Folder for new tabs'),
        row('Cmder folder', this.text('cmderRoot', { placeholder: () => this.ctx.cmderRoot }), 'Where init.bat and profile.ps1 load from')),
      section('Behavior',
        row('Copy on select', this.switchControl('copyOnSelect')),
        row('Right-click pastes', this.switchControl('rightClickPaste')),
        row('Confirm multi-line paste', this.switchControl('confirmMultilinePaste'), 'Each line runs as a command in cmd'),
        row('GPU rendering', this.switchControl('gpuAcceleration'), 'Turn off if text looks wrong'),
        row('Scrollback', this.stepper('scrollback', { min: 1000, max: 100000, step: 1000, unit: '' }))),
      h('p', { class: 'drawer-note' }, 'Type ', h('code', null, '/settings'), ' in any Cmder shell to open this panel.'),
    );
  }

  register(key, sync) {
    this.controls.push({ key, sync });
  }

  select(key, options, numeric = false) {
    const el = h('select', { class: 'field select' },
      options.map(([v, label]) => h('option', { value: String(v) }, label)));
    el.addEventListener('change', () => this.set({ [key]: numeric ? Number(el.value) : el.value }));
    this.register(key, (v) => { el.value = String(v); });
    return h('div', { class: 'select-wrap' }, el);
  }

  profileSelect() {
    const el = h('select', { class: 'field select' });
    el.addEventListener('change', () => this.set({ defaultProfile: el.value }));
    this.register('defaultProfile', (v) => {
      el.replaceChildren(...this.ctx.profiles.filter((p) => p.available)
        .map((p) => h('option', { value: p.id }, p.name)));
      el.value = v;
    });
    return h('div', { class: 'select-wrap' }, el);
  }

  fontSelect(key, kind) {
    const el = h('select', { class: 'field select font-select' });
    const custom = h('input', { class: 'field text', placeholder: 'Font name', spellcheck: false, hidden: true });
    const fill = () => {
      const current = this.ctx.settings[key];
      const list = kind === 'mono' ? this.fonts.mono : this.fonts.all;
      const names = list.includes(current) || !current ? list : [current, ...list];
      el.replaceChildren(
        ...names.map((f) => {
          const label = f === BUNDLED_MONO ? 'JetBrains Mono (bundled)' : f === BUNDLED_UI ? 'Inter (bundled)' : f;
          return h('option', { value: f, style: { fontFamily: `"${f}"` } }, label);
        }),
        h('option', { value: OTHER }, 'Other…'));
      el.value = current;
    };
    el._refill = fill;
    el.addEventListener('change', () => {
      if (el.value === OTHER) {
        custom.hidden = false;
        custom.value = this.ctx.settings[key] || '';
        custom.focus();
        custom.select();
        return;
      }
      custom.hidden = true;
      this.set({ [key]: el.value });
    });
    custom.addEventListener('change', () => {
      const v = custom.value.trim();
      if (v) this.set({ [key]: v });
      custom.hidden = true;
    });
    this.register(key, () => {
      if (document.activeElement !== custom) fill();
    });
    (this._fontSelects ||= []).push(el);
    return h('div', { class: 'font-field' }, h('div', { class: 'select-wrap' }, el), custom);
  }

  text(key, { placeholder }) {
    const el = h('input', { class: 'field text', spellcheck: false });
    el.addEventListener('change', () => this.set({ [key]: el.value.trim() || null }));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') el.blur();
    });
    this.register(key, (v) => {
      el.placeholder = typeof placeholder === 'function' ? placeholder() : placeholder;
      if (document.activeElement !== el) el.value = v || '';
    });
    return el;
  }

  switchControl(key) {
    const el = h('button', { class: 'switch', role: 'switch' }, h('span', { class: 'knob' }));
    el.addEventListener('click', () => this.set({ [key]: !this.ctx.settings[key] }));
    this.register(key, (v) => {
      el.classList.toggle('on', !!v);
      el.setAttribute('aria-checked', String(!!v));
    });
    return el;
  }

  stepper(key, { min, max, step, unit }) {
    const value = h('input', { class: 'stepper-value', inputMode: 'numeric' });
    const apply = (v) => {
      const n = clamp(Math.round(Number(v) / step) * step, min, max);
      if (Number.isFinite(n)) this.set({ [key]: n });
    };
    value.addEventListener('change', () => apply(value.value));
    value.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        apply(this.ctx.settings[key] + (e.key === 'ArrowUp' ? step : -step));
      } else if (e.key === 'Enter') value.blur();
    });
    const el = h('div', { class: 'stepper' },
      h('button', { title: 'Smaller', onclick: () => apply(this.ctx.settings[key] - step) }, icon('minus')),
      value,
      h('span', { class: 'unit' }, unit),
      h('button', { title: 'Larger', onclick: () => apply(this.ctx.settings[key] + step) }, icon('plus')));
    this.register(key, (v) => {
      if (document.activeElement !== value) value.value = String(v);
    });
    return el;
  }

  range(key, { min, max, step, format }) {
    const input = h('input', { type: 'range', min, max, step, class: 'range' });
    const out = h('span', { class: 'range-value' });
    input.addEventListener('input', () => {
      out.textContent = format(Number(input.value));
      this.set({ [key]: Number(input.value) });
    });
    this.register(key, (v) => {
      input.value = String(v);
      out.textContent = format(Number(v));
    });
    return h('div', { class: 'range-wrap' }, input, out);
  }

  segmented(key, options) {
    const buttons = options.map(([v, label]) => {
      const b = h('button', { dataset: { value: v } }, label);
      b.addEventListener('click', () => this.set({ [key]: v }));
      return b;
    });
    this.register(key, (v) => buttons.forEach((b) => b.classList.toggle('on', b.dataset.value === v)));
    return h('div', { class: 'segmented' }, buttons);
  }

  renderThemes() {
    const current = this.ctx.settings.theme;
    const hadFocus = this.themeGrid.contains(document.activeElement);
    this.themeGrid.replaceChildren(...this.ctx.themes.map((t) => {
      const card = h('button', {
        class: `theme-card${t.id === current ? ' selected' : ''}`,
        style: { background: t.background, color: t.foreground },
        title: t.custom ? `${t.name} (from config/themes)` : t.name,
        onclick: () => this.set({ theme: t.id }),
      },
      h('span', { class: 'theme-preview' },
        h('span', { style: { color: t.green } }, 'λ '),
        h('span', { style: { color: t.blue } }, '~/cmder'),
        h('span', { style: { color: t.foreground } }, ' git'),
        h('span', { class: 'theme-cursor', style: { background: t.cursor } })),
      h('span', { class: 'theme-swatches' },
        ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'].map((c) => h('i', { style: { background: t[c] } }))),
      h('span', { class: 'theme-name', style: { color: t.foreground } }, t.name));
      return card;
    }));
    if (hadFocus) (this.themeGrid.querySelector('.selected') || this.root).focus({ preventScroll: true });
  }

  refresh() {
    if (!this.isOpen) return;
    for (const c of this.controls) c.sync(this.ctx.settings[c.key]);
    this.renderThemes();
  }

  async loadFonts() {
    if (this._fontsLoaded) return;
    this._fontsLoaded = true;
    let families = [];
    try {
      if (window.queryLocalFonts) {
        const list = await window.queryLocalFonts();
        families = [...new Set(list.map((f) => f.family))];
      }
    } catch { /* permission or API missing: keep the short list */ }
    if (!families.length) return;
    families = families.filter((f) => f && !f.startsWith('@')).sort((a, b) => a.localeCompare(b));

    const canvas = document.createElement('canvas').getContext('2d');
    const isMono = (fam) => {
      canvas.font = `20px "${fam}", serif`;
      const a = canvas.measureText('iiiiiiii').width;
      const b = canvas.measureText('WWWWWWWW').width;
      const c = canvas.measureText('mmmm....').width;
      return a > 0 && Math.abs(a - b) < 0.6 && Math.abs(a - c) < 0.6;
    };
    const mono = families.filter(isMono);
    this.fonts = {
      mono: [...new Set([BUNDLED_MONO, ...mono])],
      all: [...new Set([BUNDLED_UI, ...families])],
    };
    for (const el of this._fontSelects || []) el._refill();
  }

  async confirmReset() {
    const ok = await this.ctx.confirm('Reset all settings to their defaults?', 'Reset');
    if (ok) await window.cmder.settings.reset();
  }
}
