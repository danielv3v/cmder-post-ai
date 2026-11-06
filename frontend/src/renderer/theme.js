import { fontStack, isLight, withAlpha } from './util.js';

// The window chrome takes its colors from the terminal theme, so the tab bar
// blends into the terminal instead of sitting on top of it as a white strip.
export function applyChrome(theme, settings) {
  const root = document.documentElement.style;
  const light = isLight(theme.background);
  root.setProperty('--bg', theme.background);
  root.setProperty('--fg', theme.foreground);
  root.setProperty('--accent', theme.accent || theme.blue);
  root.setProperty('--danger', theme.red);
  root.setProperty('--ui-font', fontStack(settings.uiFontFamily, 'ui'));
  root.setProperty('--ui-size', `${settings.uiFontSize}px`);
  root.setProperty('--pad', `${settings.padding}px`);
  root.setProperty('--shadow-alpha', light ? '0.14' : '0.42');
  root.setProperty('color-scheme', light ? 'light' : 'dark');
  document.documentElement.dataset.scheme = light ? 'light' : 'dark';
}

export function xtermTheme(theme) {
  return {
    background: theme.background,
    foreground: theme.foreground,
    cursor: theme.cursor,
    cursorAccent: theme.background,
    selectionBackground: theme.selectionBackground,
    selectionInactiveBackground: withAlpha(theme.selectionBackground, 0.6),
    scrollbarSliderBackground: withAlpha(theme.foreground, 0.12),
    scrollbarSliderHoverBackground: withAlpha(theme.foreground, 0.22),
    scrollbarSliderActiveBackground: withAlpha(theme.foreground, 0.3),
    black: theme.black,
    red: theme.red,
    green: theme.green,
    yellow: theme.yellow,
    blue: theme.blue,
    magenta: theme.magenta,
    cyan: theme.cyan,
    white: theme.white,
    brightBlack: theme.brightBlack,
    brightRed: theme.brightRed,
    brightGreen: theme.brightGreen,
    brightYellow: theme.brightYellow,
    brightBlue: theme.brightBlue,
    brightMagenta: theme.brightMagenta,
    brightCyan: theme.brightCyan,
    brightWhite: theme.brightWhite,
  };
}

export function searchDecorations(theme) {
  return {
    matchBackground: withAlpha(theme.yellow, 0.35),
    matchBorder: 'transparent',
    matchOverviewRuler: theme.yellow,
    activeMatchBackground: withAlpha(theme.accent || theme.blue, 0.6),
    activeMatchBorder: theme.accent || theme.blue,
    activeMatchColorOverviewRuler: theme.accent || theme.blue,
  };
}
