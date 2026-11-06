import { h, fuzzyScore } from './util.js';

// Ctrl+T: pick a shell (Enter = new tab, Alt+Enter = split) or run an action.
// Typing filters; themes only show up once you type, to keep the list short.

const SHELL_GLYPH = { cmder: 'λ', powershell: '>_', pwsh: '>_', bash: '$' };

export class Palette {
  constructor(ctx) {
    this.ctx = ctx;
    this.items = [];
    this.visible = [];
    this.index = 0;

    this.input = h('input', {
      class: 'palette-input',
      placeholder: 'Open a shell or run a command…',
      spellcheck: false,
      autocomplete: 'off',
    });
    this.list = h('div', { class: 'palette-list', role: 'listbox' });
    this.card = h('div', { class: 'palette' },
      this.input,
      this.list,
      h('div', { class: 'palette-footer' },
        h('span', null, h('kbd', null, '↵'), ' new tab'),
        h('span', null, h('kbd', null, 'Alt'), h('kbd', null, '↵'), ' split right'),
        h('span', null, h('kbd', null, 'Shift'), h('kbd', null, 'Alt'), h('kbd', null, '↵'), ' split down'),
        h('span', { class: 'spacer' }),
        h('span', null, h('kbd', null, 'Esc'), ' close')));
    this.root = h('div', { class: 'overlay palette-overlay' },
      h('div', { class: 'backdrop', onclick: () => this.close() }),
      this.card);
    document.body.append(this.root);

    this.input.addEventListener('input', () => {
      this.index = 0;
      this.render();
    });
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => {
      // Clicking an item blurs the input first; let the click land before closing.
      setTimeout(() => {
        if (this.isOpen && !this.root.contains(document.activeElement)) this.close();
      }, 120);
    });
  }

  get isOpen() {
    return this.root.classList.contains('open');
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open(query = '') {
    this.items = this.buildItems();
    this.input.value = query;
    this.index = 0;
    this.render();
    this.root.classList.add('open');
    this.input.focus();
  }

  close() {
    if (!this.isOpen) return;
    this.root.classList.remove('open');
    this.ctx.workspace.focusActive();
  }

  buildItems() {
    const { ctx } = this;
    const ws = ctx.workspace;
    const def = ctx.settings.defaultProfile;
    const shells = ctx.profiles
      .filter((p) => p.available)
      .sort((a, b) => (a.id === def ? -1 : b.id === def ? 1 : 0))
      .map((p, i) => ({
        group: 'Shells',
        label: p.name,
        detail: p.id === def ? `${p.description} · default` : p.description,
        glyph: SHELL_GLYPH[p.id] || p.short.slice(0, 2),
        hint: i < 4 ? `Shift+Alt+${ctx.profiles.filter((x) => x.available).indexOf(p) + 1}` : '',
        shell: true,
        run: ({ alt, shift }) => (alt ? ws.split(shift ? 'column' : 'row', p.id) : ws.newTab(p.id)),
      }));

    const action = (label, hint, run, glyph = '›') => ({ group: 'Actions', label, hint, run, glyph, detail: '' });
    const actions = [
      action('Split right', 'Ctrl+Shift+E', () => ws.split('row')),
      action('Split down', 'Ctrl+Shift+O', () => ws.split('column')),
      action('Move pane to its own tab', 'Alt+Click tab', () => ws.detachFocusedPane()),
      action('Rename tab', 'F2', () => ws.renameActive()),
      action('Find in terminal', 'Ctrl+Shift+F', () => ctx.search.open()),
      action('Settings', 'Ctrl+,', () => ctx.settingsPanel.open(), '⚙'),
      action('Toggle fullscreen', 'F11', () => window.cmder.win.toggleFullscreen()),
      action('Close pane', 'Ctrl+W', () => ws.closeFocusedPane()),
    ];

    const themes = ctx.themes.map((t) => ({
      group: 'Themes',
      label: `Theme: ${t.name}`,
      detail: t.id === ctx.settings.theme ? 'current' : '',
      swatch: t,
      hint: '',
      searchOnly: true,
      run: () => ctx.updateSettings({ theme: t.id }),
    }));

    return [...shells, ...actions, ...themes];
  }

  render() {
    const q = this.input.value.trim();
    let visible;
    if (!q) {
      visible = this.items.filter((i) => !i.searchOnly);
    } else {
      visible = this.items
        .map((item) => ({ item, score: fuzzyScore(q, `${item.label} ${item.detail}`) }))
        .filter((x) => x.score !== null)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.item);
    }
    this.visible = visible;
    this.index = Math.min(this.index, Math.max(0, visible.length - 1));

    const nodes = [];
    let lastGroup = null;
    visible.forEach((item, i) => {
      if (!q && item.group !== lastGroup) {
        nodes.push(h('div', { class: 'palette-group' }, item.group));
        lastGroup = item.group;
      }
      const lead = item.swatch
        ? h('span', { class: 'glyph swatch', style: { background: item.swatch.background, color: item.swatch.accent } }, '●')
        : h('span', { class: `glyph${item.shell ? ' shell' : ''}` }, item.glyph);
      const row = h('div', {
        class: `palette-item${i === this.index ? ' selected' : ''}`,
        role: 'option',
        onmousemove: () => {
          if (this.index !== i) {
            this.index = i;
            this.highlight();
          }
        },
        onmousedown: (e) => e.preventDefault(),
        onclick: (e) => this.run(item, { alt: e.altKey, shift: e.shiftKey }),
      },
      lead,
      h('span', { class: 'label' }, item.label),
      item.detail ? h('span', { class: 'detail' }, item.detail) : null,
      item.hint ? h('span', { class: 'hint' }, item.hint) : null);
      nodes.push(row);
    });
    if (!visible.length) nodes.push(h('div', { class: 'palette-empty' }, 'Nothing matches'));
    this.list.replaceChildren(...nodes);
    this.highlight();
  }

  highlight() {
    const rows = this.list.querySelectorAll('.palette-item');
    rows.forEach((r, i) => r.classList.toggle('selected', i === this.index));
    rows[this.index]?.scrollIntoView({ block: 'nearest' });
  }

  onKey(e) {
    const n = this.visible.length;
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault();
      if (n) this.index = (this.index + 1) % n;
      this.highlight();
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault();
      if (n) this.index = (this.index - 1 + n) % n;
      this.highlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = this.visible[this.index];
      if (item) this.run(item, { alt: e.altKey, shift: e.shiftKey });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    }
  }

  run(item, mods) {
    this.root.classList.remove('open');
    // Run after the overlay is gone so the new pane can take focus.
    requestAnimationFrame(() => {
      // Give focus back first; actions that open something (rename, settings) then take it.
      this.ctx.workspace.focusActive();
      Promise.resolve(item.run(mods)).catch((err) => this.ctx.toast(err.message));
    });
  }
}
