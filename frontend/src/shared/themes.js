'use strict';

// Built-in themes. Each theme sets the terminal palette; the window chrome
// (tab bar, palette, settings) is derived from background/foreground/accent.
// Extra themes can be dropped into config/themes/*.json using the same keys.

const ansi = (c) => ({
  black: c[0], red: c[1], green: c[2], yellow: c[3],
  blue: c[4], magenta: c[5], cyan: c[6], white: c[7],
  brightBlack: c[8], brightRed: c[9], brightGreen: c[10], brightYellow: c[11],
  brightBlue: c[12], brightMagenta: c[13], brightCyan: c[14], brightWhite: c[15],
});

const THEMES = [
  {
    id: 'midnight', name: 'Midnight',
    background: '#0e1014', foreground: '#d4d8df', cursor: '#e6e9ef',
    selectionBackground: '#3a4458', accent: '#6cb6ff',
    ...ansi(['#1c1f26', '#ef6b73', '#7fd18b', '#f2c66d', '#6cb6ff', '#c49bff', '#5fd4d4', '#c7ccd4',
      '#5c6370', '#ff8a90', '#9be3a5', '#ffd88a', '#8ecbff', '#d6b8ff', '#84e6e6', '#f5f7fa']),
  },
  {
    // The palette Cmder has always shipped with (vendor/ConEmu.xml.default).
    id: 'cmder', name: 'Cmder Classic',
    background: '#272822', foreground: '#cacaca', cursor: '#cacaca',
    selectionBackground: '#4a4b42', accent: '#8dd006',
    ...ansi(['#272822', '#a70334', '#74aa04', '#b6b649', '#01549e', '#89569c', '#1a83a6', '#cacaca',
      '#7c7c7c', '#f3044b', '#8dd006', '#cccc81', '#0383f5', '#a87db8', '#58c2e5', '#ffffff']),
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night',
    background: '#1a1b26', foreground: '#c0caf5', cursor: '#c0caf5',
    selectionBackground: '#33467c', accent: '#7aa2f7',
    ...ansi(['#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
      '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5']),
  },
  {
    id: 'catppuccin-mocha', name: 'Catppuccin Mocha',
    background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc',
    selectionBackground: '#45475a', accent: '#cba6f7',
    ...ansi(['#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
      '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8']),
  },
  {
    id: 'dracula', name: 'Dracula',
    background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2',
    selectionBackground: '#44475a', accent: '#bd93f9',
    ...ansi(['#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
      '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff']),
  },
  {
    id: 'nord', name: 'Nord',
    background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9',
    selectionBackground: '#434c5e', accent: '#88c0d0',
    ...ansi(['#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
      '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4']),
  },
  {
    id: 'one-dark', name: 'One Dark',
    background: '#282c34', foreground: '#abb2bf', cursor: '#528bff',
    selectionBackground: '#3e4451', accent: '#61afef',
    ...ansi(['#1e2127', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
      '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff']),
  },
  {
    id: 'gruvbox-dark', name: 'Gruvbox Dark',
    background: '#282828', foreground: '#ebdbb2', cursor: '#ebdbb2',
    selectionBackground: '#504945', accent: '#fabd2f',
    ...ansi(['#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
      '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2']),
  },
  {
    id: 'rose-pine', name: 'Rosé Pine',
    background: '#191724', foreground: '#e0def4', cursor: '#e0def4',
    selectionBackground: '#403d52', accent: '#c4a7e7',
    ...ansi(['#26233a', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4',
      '#6e6a86', '#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#ebbcba', '#e0def4']),
  },
  {
    id: 'daylight', name: 'Daylight',
    background: '#fafafa', foreground: '#24292f', cursor: '#0969da',
    selectionBackground: '#cfe3fb', accent: '#0969da',
    ...ansi(['#24292f', '#cf222e', '#116329', '#7d4e00', '#0969da', '#8250df', '#1b7c83', '#6e7781',
      '#57606a', '#a40e26', '#1a7f37', '#9a6700', '#218bff', '#a475f9', '#3192aa', '#8c959f']),
  },
  {
    id: 'catppuccin-latte', name: 'Catppuccin Latte',
    background: '#eff1f5', foreground: '#4c4f69', cursor: '#dc8a78',
    selectionBackground: '#ccd0da', accent: '#8839ef',
    ...ansi(['#5c5f77', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#acb0be',
      '#6c6f85', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#bcc0cc']),
  },
];

const THEME_KEYS = ['background', 'foreground', 'cursor', 'selectionBackground', 'accent',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];

// Fill gaps in a user theme from Midnight so a partial file still works.
function normalizeTheme(t, fallbackId) {
  const base = THEMES[0];
  const out = { id: t.id || fallbackId, name: t.name || t.id || fallbackId };
  for (const k of THEME_KEYS) out[k] = typeof t[k] === 'string' ? t[k] : base[k];
  if (typeof t.cursor !== 'string') out.cursor = out.foreground;
  if (typeof t.accent !== 'string') out.accent = out.blue;
  out.custom = true;
  return out;
}

module.exports = { THEMES, THEME_KEYS, normalizeTheme };
