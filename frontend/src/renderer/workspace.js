import { Pane } from './terminal.js';
import { h, icon, clamp } from './util.js';

// A tab is a group of panes laid out as a binary split tree:
//   { type: 'pane', paneId } | { type: 'split', dir: 'row' | 'column', ratio, children: [a, b] }
// Nodes are mutated in place so divider drags can keep a reference to their node.

let tabSeq = 0;
const leaf = (paneId) => ({ type: 'pane', paneId });
const splitNode = (dir, a, b) => ({ type: 'split', dir, ratio: 0.5, children: [a, b] });

export function leaves(node, out = []) {
  if (!node) return out;
  if (node.type === 'pane') out.push(node.paneId);
  else for (const c of node.children) leaves(c, out);
  return out;
}

function replaceLeaf(node, paneId, replacement) {
  if (node.type === 'pane') return node.paneId === paneId ? replacement : node;
  node.children = node.children.map((c) => replaceLeaf(c, paneId, replacement));
  return node;
}

function removeLeaf(node, paneId) {
  if (node.type === 'pane') return node.paneId === paneId ? null : node;
  const kids = node.children.map((c) => removeLeaf(c, paneId)).filter(Boolean);
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  node.children = kids;
  return node;
}

const EASE = 'transform 150ms cubic-bezier(.2,.8,.2,1)';

export class Workspace {
  constructor(ctx, { stage, tabBar }) {
    this.ctx = ctx;
    this.stage = stage;
    this.tabBar = tabBar;
    this.tabs = [];
    this.activeId = null;
    this.panes = new Map();
    this.tabEls = new Map();
    this.dragging = false;
    this.renaming = null;
    this._barFrame = 0;

    // Keep focus in the terminal when clicking tabs (except while renaming one).
    tabBar.addEventListener('mousedown', (e) => {
      if (!e.target.isContentEditable) e.preventDefault();
    });
    // Vertical wheel scrolls an overflowing tab strip sideways.
    tabBar.addEventListener('wheel', (e) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      tabBar.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
  }

  // ------------------------------------------------------------ lookup

  get active() {
    return this.tabs.find((t) => t.id === this.activeId) || null;
  }

  get activePane() {
    const t = this.active;
    return t ? this.panes.get(t.focusedPaneId) || null : null;
  }

  tabOfPane(pane) {
    return this.tabs.find((t) => t.id === pane.tabId) || null;
  }

  indexOfActive() {
    return this.tabs.findIndex((t) => t.id === this.activeId);
  }

  allPanes() {
    return [...this.panes.values()];
  }

  // ------------------------------------------------------------ creating

  _createPane(profileId, cwd) {
    const pane = new Pane(this.ctx, { profileId, cwd });
    this.panes.set(pane.id, pane);
    return pane;
  }

  _addTab(root, focusedPaneId, index) {
    const tab = {
      id: ++tabSeq,
      title: null,
      root,
      focusedPaneId,
      activity: false,
      el: h('div', { class: 'tab-root' }),
    };
    this.stage.append(tab.el);
    this.tabs.splice(clamp(index ?? this.tabs.length, 0, this.tabs.length), 0, tab);
    this.renderLayout(tab);
    return tab;
  }

  async newTab(profileId, { cwd } = {}) {
    const pane = this._createPane(profileId || this.ctx.settings.defaultProfile, cwd);
    const tab = this._addTab(leaf(pane.id), pane.id);
    this.activate(tab.id);
    pane.open();
    pane.focus();
    await pane.start();
    return tab;
  }

  // New shell next to the focused pane; inherits its shell and folder.
  async split(dir = 'row', profileId) {
    const tab = this.active;
    const focused = this.activePane;
    if (!tab || !focused) return this.newTab(profileId);
    const pane = this._createPane(profileId || focused.profileId, focused.cwd);
    tab.root = replaceLeaf(tab.root, focused.id, splitNode(dir, leaf(focused.id), leaf(pane.id)));
    tab.focusedPaneId = pane.id;
    this.renderLayout(tab);
    pane.open();
    this.refit(tab);
    pane.focus();
    this.syncBar();
    await pane.start();
  }

  // Alt+Click: pull another tab into the current one as a split,
  // or (on the current tab) pop the focused pane back out into its own tab.
  altClickTab(tabId, vertical) {
    if (tabId === this.activeId) this.detachFocusedPane();
    else this.joinTab(tabId, vertical ? 'column' : 'row');
  }

  joinTab(sourceId, dir = 'row') {
    const target = this.active;
    const source = this.tabs.find((t) => t.id === sourceId);
    if (!target || !source || source === target) return;
    target.root = replaceLeaf(target.root, target.focusedPaneId,
      splitNode(dir, leaf(target.focusedPaneId), source.root));
    target.focusedPaneId = source.focusedPaneId;
    if (!target.title && source.title) target.title = source.title;
    this._removeTab(source);
    this.renderLayout(target);
    this.refit(target);
    this.syncBar();
    this.focusActive();
  }

  detachFocusedPane() {
    const tab = this.active;
    if (!tab) return;
    const ids = leaves(tab.root);
    if (ids.length < 2) {
      this.ctx.toast('This tab has one pane. Alt+Click another tab to split it in here.');
      return;
    }
    const paneId = tab.focusedPaneId;
    const idx = ids.indexOf(paneId);
    tab.root = removeLeaf(tab.root, paneId);
    const rest = leaves(tab.root);
    tab.focusedPaneId = rest[Math.max(0, idx - 1)] ?? rest[0];
    this.renderLayout(tab);
    const fresh = this._addTab(leaf(paneId), paneId, this.tabs.indexOf(tab) + 1);
    this.activate(fresh.id);
  }

  // ------------------------------------------------------------ closing

  closePane(pane) {
    const tab = this.tabOfPane(pane);
    this.panes.delete(pane.id);
    this.ctx.unregisterPty(pane);
    if (!tab) {
      pane.dispose();
      return;
    }
    const ids = leaves(tab.root);
    const idx = ids.indexOf(pane.id);
    tab.root = removeLeaf(tab.root, pane.id);
    pane.dispose();
    if (!tab.root) {
      this._closeTabShell(tab);
      return;
    }
    if (tab.focusedPaneId === pane.id) {
      const rest = leaves(tab.root);
      tab.focusedPaneId = rest[Math.max(0, idx - 1)] ?? rest[0];
    }
    this.renderLayout(tab);
    this.refit(tab);
    this.syncBar();
    if (tab.id === this.activeId) this.focusActive();
  }

  closeFocusedPane() {
    const pane = this.activePane;
    if (pane) this.closePane(pane);
  }

  closeTab(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    for (const id of leaves(tab.root)) {
      const pane = this.panes.get(id);
      if (!pane) continue;
      this.panes.delete(id);
      this.ctx.unregisterPty(pane);
      pane.dispose();
    }
    this._closeTabShell(tab);
  }

  _removeTab(tab) {
    const i = this.tabs.indexOf(tab);
    if (i >= 0) this.tabs.splice(i, 1);
    tab.el.remove();
    this.tabEls.get(tab.id)?.remove();
    this.tabEls.delete(tab.id);
    return i;
  }

  _closeTabShell(tab) {
    const i = this._removeTab(tab);
    if (!this.tabs.length) {
      window.cmder.win.close();
      return;
    }
    if (this.activeId === tab.id) this.activate(this.tabs[clamp(i, 0, this.tabs.length - 1)].id);
    else this.syncBar();
  }

  // ------------------------------------------------------------ navigation

  activate(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    this.activeId = tabId;
    tab.activity = false;
    for (const t of this.tabs) t.el.classList.toggle('active', t === tab);
    this.syncBar();
    this.refit(tab);
    this.focusActive();
    this.ctx.onActiveChanged();
  }

  cycle(delta) {
    const n = this.tabs.length;
    if (n < 2) return;
    this.activate(this.tabs[(this.indexOfActive() + delta + n) % n].id);
  }

  goto(index) {
    const tab = index < 0 ? this.tabs[this.tabs.length - 1] : this.tabs[index];
    if (tab) this.activate(tab.id);
  }

  moveActive(delta) {
    const i = this.indexOfActive();
    const j = clamp(i + delta, 0, this.tabs.length - 1);
    if (i < 0 || i === j) return;
    const [tab] = this.tabs.splice(i, 1);
    this.tabs.splice(j, 0, tab);
    this.syncBar();
  }

  focusActive() {
    this.activePane?.focus();
  }

  focusDirection(dir) {
    const tab = this.active;
    const current = this.activePane;
    if (!tab || !current) return;
    const cur = current.el.getBoundingClientRect();
    const cx = cur.left + cur.width / 2;
    const cy = cur.top + cur.height / 2;
    let best = null;
    let bestDist = Infinity;
    for (const id of leaves(tab.root)) {
      if (id === current.id) continue;
      const pane = this.panes.get(id);
      const r = pane.el.getBoundingClientRect();
      const ok = dir === 'left' ? r.right <= cur.left + 2
        : dir === 'right' ? r.left >= cur.right - 2
          : dir === 'up' ? r.bottom <= cur.top + 2
            : r.top >= cur.bottom - 2;
      if (!ok) continue;
      const dist = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
      if (dist < bestDist) {
        bestDist = dist;
        best = pane;
      }
    }
    best?.focus();
  }

  onPaneFocused(pane) {
    const tab = this.tabOfPane(pane);
    if (!tab || tab.focusedPaneId === pane.id) return;
    tab.focusedPaneId = pane.id;
    this._updateFocusClasses(tab);
    this.scheduleBar();
  }

  markActivity(pane) {
    const tab = this.tabOfPane(pane);
    if (!tab || tab.id === this.activeId || tab.activity) return;
    tab.activity = true;
    this.scheduleBar();
  }

  refit(tab) {
    for (const id of leaves(tab.root)) this.panes.get(id)?.scheduleFit();
  }

  // ------------------------------------------------------------ layout DOM

  renderLayout(tab) {
    for (const id of leaves(tab.root)) {
      const pane = this.panes.get(id);
      if (pane) pane.tabId = tab.id;
    }
    tab.el.replaceChildren(this._buildNode(tab.root));
    this._updateFocusClasses(tab);
  }

  _updateFocusClasses(tab) {
    const ids = leaves(tab.root);
    tab.el.classList.toggle('multi', ids.length > 1);
    for (const id of ids) this.panes.get(id)?.el.classList.toggle('focused', id === tab.focusedPaneId);
  }

  _buildNode(node) {
    if (node.type === 'pane') return this.panes.get(node.paneId).el;
    const a = h('div', { class: 'split-child' }, this._buildNode(node.children[0]));
    const b = h('div', { class: 'split-child' }, this._buildNode(node.children[1]));
    const setFlex = () => {
      a.style.flex = `${node.ratio} 1 0px`;
      b.style.flex = `${1 - node.ratio} 1 0px`;
    };
    setFlex();
    const divider = h('div', { class: 'divider', title: 'Drag to resize, double-click to even out' });
    const wrap = h('div', { class: `split ${node.dir}` }, a, divider, b);

    divider.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      divider.setPointerCapture(e.pointerId);
      divider.classList.add('dragging');
      document.body.classList.add(node.dir === 'row' ? 'resizing-col' : 'resizing-row');
      const move = (ev) => {
        const r = wrap.getBoundingClientRect();
        const ratio = node.dir === 'row' ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
        node.ratio = clamp(ratio, 0.08, 0.92);
        setFlex();
      };
      const up = () => {
        divider.classList.remove('dragging');
        document.body.classList.remove('resizing-col', 'resizing-row');
        divider.removeEventListener('pointermove', move);
        divider.removeEventListener('pointerup', up);
        divider.removeEventListener('pointercancel', up);
        this.focusActive();
      };
      divider.addEventListener('pointermove', move);
      divider.addEventListener('pointerup', up);
      divider.addEventListener('pointercancel', up);
    });
    divider.addEventListener('dblclick', () => {
      node.ratio = 0.5;
      setFlex();
    });
    return wrap;
  }

  // ------------------------------------------------------------ tab bar

  scheduleBar() {
    if (this._barFrame) return;
    this._barFrame = requestAnimationFrame(() => {
      this._barFrame = 0;
      this.syncBar();
    });
  }

  syncBar() {
    const bar = this.tabBar;
    const live = new Set();
    this.tabs.forEach((tab, i) => {
      live.add(tab.id);
      let el = this.tabEls.get(tab.id);
      if (!el) {
        el = this._createTabEl(tab);
        this.tabEls.set(tab.id, el);
      }
      this._updateTabEl(el, tab);
      if (!this.dragging && bar.children[i] !== el) bar.insertBefore(el, bar.children[i] || null);
      else if (!el.isConnected) bar.append(el);
    });
    for (const [id, el] of this.tabEls) {
      if (!live.has(id)) {
        el.remove();
        this.tabEls.delete(id);
      }
    }
    if (!this.dragging) this.tabEls.get(this.activeId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  tabLabel(tab) {
    if (tab.title) return tab.title;
    const pane = this.panes.get(tab.focusedPaneId);
    return pane ? pane.label() : 'shell';
  }

  _createTabEl(tab) {
    const label = h('span', { class: 'tab-label' });
    const countNum = h('span');
    const count = h('span', { class: 'tab-count' }, icon('split'), countNum);
    const close = h('button', { class: 'tab-close', tabIndex: -1, title: 'Close tab' }, icon('close'));
    const el = h('div', { class: 'tab', dataset: { id: String(tab.id) } }, label, count, close);
    el._label = label;
    el._count = count;
    el._countNum = countNum;

    close.addEventListener('pointerdown', (e) => e.stopPropagation());
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tab.id);
    });
    el.addEventListener('pointerdown', (e) => this._onTabPointerDown(e, tab, el));
    el.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      this.closeTab(tab.id);
    });
    el.addEventListener('dblclick', (e) => {
      if (e.target.closest('.tab-close') || e.altKey) return;
      this.startRename(tab.id);
    });
    return el;
  }

  _updateTabEl(el, tab) {
    const ids = leaves(tab.root);
    const pane = this.panes.get(tab.focusedPaneId);
    const text = this.tabLabel(tab);
    if (this.renaming !== tab.id && el._label.textContent !== text) el._label.textContent = text;
    el._countNum.textContent = String(ids.length);
    el._count.hidden = ids.length < 2;
    el.classList.toggle('active', tab.id === this.activeId);
    el.classList.toggle('activity', tab.activity && tab.id !== this.activeId);
    el.classList.toggle('multi', ids.length > 1);
    const where = [pane?.profile?.name, pane?.cwd].filter(Boolean).join('  ·  ');
    el.title = `${where}\nDouble-click to rename · Drag to reorder · Alt+Click to split`;
  }

  _onTabPointerDown(e, tab, el) {
    if (e.button === 1) {
      e.preventDefault(); // no autoscroll; auxclick closes
      return;
    }
    if (e.button !== 0 || this.renaming === tab.id) return;
    if (e.altKey) {
      e.preventDefault();
      this.altClickTab(tab.id, e.shiftKey);
      return;
    }

    this.activate(tab.id);

    const bar = this.tabBar;
    const startX = e.clientX;
    const grab = startX - el.getBoundingClientRect().left;
    const width = el.offsetWidth;
    let dragging = false;
    el.setPointerCapture(e.pointerId);

    const naturalLeft = (node) => bar.getBoundingClientRect().left + node.offsetLeft - bar.scrollLeft;

    const move = (ev) => {
      if (!dragging) {
        if (Math.abs(ev.clientX - startX) < 5) return;
        dragging = true;
        this.dragging = true;
        el.classList.add('dragging');
        bar.classList.add('reordering');
      }
      const barRect = bar.getBoundingClientRect();
      const desired = clamp(ev.clientX - grab, barRect.left - width / 2, barRect.right - width / 2);
      const mid = desired + width / 2;
      let sib;
      while ((sib = el.nextElementSibling) && mid > naturalLeft(sib) + sib.offsetWidth / 2) {
        const s = sib;
        this._flip(s, () => bar.insertBefore(s, el));
      }
      while ((sib = el.previousElementSibling) && mid < naturalLeft(sib) + sib.offsetWidth / 2) {
        const s = sib;
        this._flip(s, () => bar.insertBefore(el, s));
      }
      el.style.transform = `translateX(${desired - naturalLeft(el)}px)`;
    };

    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      if (!dragging) return;
      el.style.transition = EASE;
      el.style.transform = '';
      setTimeout(() => {
        el.style.transition = '';
        el.classList.remove('dragging');
      }, 160);
      bar.classList.remove('reordering');
      this.dragging = false;
      const order = [...bar.children].map((c) => Number(c.dataset.id));
      this.tabs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      this.syncBar();
      this.focusActive();
    };

    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // Animate a sibling from where it was to where the DOM change put it.
  _flip(node, mutate) {
    const before = node.offsetLeft;
    mutate();
    const dx = before - node.offsetLeft;
    if (!dx) return;
    node.style.transition = 'none';
    node.style.transform = `translateX(${dx}px)`;
    void node.offsetWidth;
    node.style.transition = EASE;
    node.style.transform = '';
  }

  startRename(tabId) {
    const tab = this.tabs.find((t) => t.id === tabId);
    const el = this.tabEls.get(tabId);
    if (!tab || !el || this.renaming) return;
    this.renaming = tabId;
    el.classList.add('renaming');
    const label = el._label;
    label.contentEditable = 'plaintext-only';
    label.spellcheck = false;
    label.focus();
    const range = document.createRange();
    range.selectNodeContents(label);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = (commit) => {
      label.removeEventListener('keydown', onKey);
      label.removeEventListener('blur', onBlur);
      label.removeAttribute('contenteditable');
      el.classList.remove('renaming');
      this.renaming = null;
      if (commit) {
        const value = label.textContent.replace(/\s+/g, ' ').trim();
        // Clearing the name goes back to the automatic folder name.
        tab.title = value ? value.slice(0, 60) : null;
      }
      label.textContent = '';
      this.syncBar();
      this.focusActive();
    };
    const onKey = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };
    const onBlur = () => finish(true);
    label.addEventListener('keydown', onKey);
    label.addEventListener('blur', onBlur);
  }

  renameActive() {
    if (this.activeId) this.startRename(this.activeId);
  }
}
