# Cmder window

A minimal, modern window for Cmder's shells, replacing ConEmu's UI. It runs the same `init.bat`, `profile.ps1` and bash setup, so aliases, Clink and the λ prompt work as before.

- No title bar and no white bars. The tab bar sits at the bottom and takes its colors from the terminal theme.
- No search field and no `+` button. `Ctrl+T` opens a shell picker.
- Tabs: double-click to rename, drag to reorder, middle-click to close.
- `Alt+Click` another tab to split it into the current one. `Alt+Click` the current tab to pop the focused pane back out.
- Themes, fonts, sizes and weights in a settings panel (`Ctrl+,`, or type `/settings` in a shell).

## Run it

```
cd frontend
npm install
npm start
```

`npm install` also downloads the Electron binary. If `npm start` says Electron failed to install, run `node node_modules/electron/install.js`.

The shells load Cmder from the folder that contains `frontend/`. That folder needs the vendored tools a Cmder build downloads (`vendor/clink`, and optionally `vendor/git-for-windows`); run `scripts/build.ps1` or copy them from a Cmder release. To use a different Cmder install, set **Settings → Shells → Cmder folder**. If no vendored Git is found, the Bash profile falls back to `C:\Program Files\Git\bin\bash.exe`.

## Keys

| Keys | Action |
| --- | --- |
| `Ctrl+T` | Shell picker: `Enter` new tab, `Alt+Enter` split right, `Shift+Alt+Enter` split down |
| `Ctrl+Shift+T` | New tab with the default shell, no picker |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab, instantly |
| `Ctrl+1` … `Ctrl+8`, `Ctrl+9` | Go to tab N, last tab |
| `Ctrl+Shift+PageUp` / `PageDown` | Move the current tab left / right |
| `F2` or double-click | Rename tab (clear the name to go back to the folder name) |
| `Alt+Click` tab | Split that tab into the current one (`Alt+Shift+Click` stacks it below) |
| `Alt+Click` current tab | Move the focused pane to its own tab |
| `Ctrl+Shift+E` / `Ctrl+Shift+O` | Split right / down with the same shell and folder |
| `Alt+Arrows` | Move focus between panes |
| `Ctrl+W` | Close pane (or tab) |
| `Shift+Alt+1…4` | New tab with shell 1–4 (Cmder, PowerShell, …) |
| `Ctrl+,` | Settings |
| `Ctrl+Shift+F` | Find |
| `Ctrl+C` / `Ctrl+V` | Copy when text is selected (otherwise ^C) / paste |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0`, `Ctrl+Wheel` | Font size |
| `F11` / `Alt+Enter` | Fullscreen |

Drag a divider to resize panes; double-click it to even them out. Dropping files on the window pastes their paths.

## Slash commands

Inside the window, the shells understand:

| Command | cmd (Clink) | PowerShell | Bash |
| --- | --- | --- | --- |
| Open settings | `/settings` | `/settings` | `cmder-ui settings` |
| Switch theme | `/theme nord` | `/theme nord` | `cmder-ui theme nord` |
| Shell picker | `/new` | `/new` | `cmder-ui new` |

In cmd without Clink, use `cmder-ui settings`. These hooks live in `vendor/cmder_ui.lua`, `vendor/profile.ps1`, `vendor/cmder.sh` and `vendor/bin/cmder-ui.cmd`. They do nothing outside this window.

## Settings and themes

Settings are saved to `config/user-ui.json`. The file is watched, so hand edits apply immediately. **Edit JSON** in the panel opens it.

Built-in themes: Midnight (default), Cmder Classic, Tokyo Night, Catppuccin Mocha and Latte, Dracula, Nord, One Dark, Gruvbox Dark, Rosé Pine and Daylight. To add your own, drop a JSON file into `config/themes/` (**Themes folder** in the panel). Missing keys fall back to Midnight:

```json
{
  "name": "My Theme",
  "background": "#101418", "foreground": "#d0d6de", "cursor": "#ffcc66",
  "selectionBackground": "#2b3542", "accent": "#ffcc66",
  "black": "#1a1f26", "red": "#f07178", "green": "#a6cc70", "yellow": "#ffcc66",
  "blue": "#5ccfe6", "magenta": "#d4bfff", "cyan": "#95e6cb", "white": "#c7ccd4",
  "brightBlack": "#5c6773", "brightRed": "#ff8f98", "brightGreen": "#bae67e", "brightYellow": "#ffd580",
  "brightBlue": "#73d0ff", "brightMagenta": "#dfbfff", "brightCyan": "#a6f0d8", "brightWhite": "#f5f7fa"
}
```

Extra shells go in `profiles`:

```json
"profiles": [
  { "name": "WSL", "command": "C:\\Windows\\System32\\wsl.exe", "args": ["~"] }
]
```

## How it fits together

- `src/main/`: Electron main process. Starts each shell in a ConPTY (`node-pty`), stores settings, and handles the frameless window.
- `src/renderer/`: the UI. `workspace.js` (tabs, split tree, drag/rename/Alt+Click), `terminal.js` (one xterm.js pane), `palette.js` (Ctrl+T), `settings-panel.js`, `theme.js`.
- `src/shared/themes.js`: built-in themes.
- Shells report their folder with OSC 9;9 (cmd, PowerShell) or OSC 7 (bash), so splits open in the same place. They request UI actions with the private sequence `OSC 7337`.

`npm run dev` starts with `Ctrl+Shift+I` dev tools enabled. `npm run watch` rebuilds the UI on save; reload with dev tools open.
