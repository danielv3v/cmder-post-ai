'use strict';

// Settings live in <cmder>/config/user-ui.json so they travel with a portable
// Cmder folder, like the rest of the user config. The file is plain JSON and
// is watched, so hand edits apply immediately.

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { normalizeTheme } = require('../shared/themes');

const DEFAULTS = Object.freeze({
  theme: 'midnight',
  fontFamily: 'Cascadia Mono',
  fontSize: 14,
  fontWeight: 400,
  fontWeightBold: 700,
  lineHeight: 1.2,
  letterSpacing: 0,
  cursorStyle: 'bar',
  cursorBlink: true,
  uiFontFamily: 'Inter Variable',
  uiFontSize: 12,
  padding: 10,
  defaultProfile: 'cmder',
  startDirectory: '',
  cmderRoot: '',
  copyOnSelect: true,
  rightClickPaste: true,
  confirmMultilinePaste: true,
  gpuAcceleration: true,
  scrollback: 10000,
  profiles: [],
});

function readJson(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  return { text, data: JSON.parse(text) };
}

class SettingsStore extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.values = { ...DEFAULTS };
    this.error = null;
    this._lastText = null;
    this._saveTimer = null;
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) {
      this.values = { ...DEFAULTS };
      return;
    }
    try {
      const { text, data } = readJson(this.file);
      this._lastText = text;
      this.values = { ...DEFAULTS, ...(data && typeof data === 'object' ? data : {}) };
      this.error = null;
    } catch (err) {
      // Keep the previous values; surface the problem instead of resetting the user's file.
      this.error = `Could not read ${path.basename(this.file)}: ${err.message}`;
    }
  }

  get() {
    return { ...this.values };
  }

  update(patch) {
    for (const [k, v] of Object.entries(patch || {})) {
      if (v === null || v === undefined) this.values[k] = DEFAULTS[k];
      else this.values[k] = v;
    }
    this._scheduleSave();
    this.emit('change', this.get());
  }

  reset() {
    this.values = { ...DEFAULTS };
    this._scheduleSave();
    this.emit('change', this.get());
  }

  _scheduleSave() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.saveNow(), 150);
  }

  saveNow() {
    clearTimeout(this._saveTimer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const text = JSON.stringify(this.values, null, 2) + '\n';
      this._lastText = text;
      fs.writeFileSync(this.file, text, 'utf8');
    } catch (err) {
      this.error = `Could not save settings: ${err.message}`;
      this.emit('error', this.error);
    }
  }

  watch() {
    fs.watchFile(this.file, { interval: 700 }, () => {
      let text;
      try { text = fs.readFileSync(this.file, 'utf8').replace(/^﻿/, ''); } catch { return; }
      if (text === this._lastText) return;
      const before = JSON.stringify(this.values);
      this.load();
      if (this.error) this.emit('error', this.error);
      else if (JSON.stringify(this.values) !== before) this.emit('change', this.get());
    });
  }
}

// Small separate file for window position so settings stay readable.
class StateStore {
  constructor(file) {
    this.file = file;
    this.values = {};
    try { this.values = readJson(file).data || {}; } catch { /* first run */ }
  }
  get(key) { return this.values[key]; }
  set(key, value) {
    this.values[key] = value;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2) + '\n', 'utf8');
    } catch { /* not critical */ }
  }
}

function loadUserThemes(dir) {
  const themes = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json')); } catch { return themes; }
  for (const f of files) {
    try {
      const { data } = readJson(path.join(dir, f));
      themes.push(normalizeTheme(data, path.basename(f, '.json')));
    } catch { /* skip broken theme files */ }
  }
  return themes;
}

module.exports = { SettingsStore, StateStore, DEFAULTS, loadUserThemes };
