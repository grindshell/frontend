# Grindshell client

The player-facing client for **Grindshell**, an in-development online multiplayer game. It is a [SolidJS](https://www.solidjs.com/) web app wrapped in a [Tauri 2](https://tauri.app/) shell, so the same codebase runs either in a browser or as a native desktop application — if you'd rather not play in a browser tab, you can build and run the desktop app yourself (see [Running the desktop app](#running-the-desktop-app)).

> Grindshell is under active development. The client connects to the game server for accounts, chat, idle combat actions, and inventory/gear; other screens (markets, rankings, area travel, …) are placeholder UI awaiting their server-side features.

## Features (current state)

- **Accounts** — register/login against the game server, with Cloudflare Turnstile verification. Sessions persist locally between launches.
- **Live chat** — multi-room chat (global, main, help, trade), DMs, and room management over a persistent WebSocket connection with automatic reconnect.
- **Idle actions (combat)** — pick a zone enemy and fight it in the background; the client renders per-tick combat updates, your formation's progress, and the final reward report.
- **Inventory & gear** — currencies, resources, and item stacks; equip/unequip gear on your units with stat-requirement previews; use consumables and watch their active effects tick down.
- **Overview dashboard** — a customizable 12-column grid of cards summarizing each game screen. Cards can be reordered and resized in arrange mode; the layout persists locally.
- **Theming** — switchable DaisyUI themes (dark by default), persisted across sessions.
- **Offline mode** — the client runs fully offline by default for UI development and previewing: no server needed, chat echoes locally, and the login screen offers a "Continue offline" button.

The client stores its data (session token, theme, dashboard layout) in local storage only; a one-time notice explains this on first launch.

## Running the desktop app

There are no prebuilt releases yet, so the desktop app is built from source.

### Prerequisites

- [Node.js](https://nodejs.org/) (LTS) and [pnpm](https://pnpm.io/)
- A [Rust](https://www.rust-lang.org/tools/install) toolchain
- Tauri's platform dependencies for your OS — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/) (WebView2 on Windows, WebKitGTK on Linux; macOS needs only Xcode command-line tools)

### Build and run

```sh
pnpm install
pnpm tauri build
```

The installer/bundle ends up under `src-tauri/target/release/bundle/` (the exact format depends on your platform — e.g. `.msi`/`.exe` on Windows, `.dmg`/`.app` on macOS, `.deb`/`.AppImage` on Linux).

To run the desktop app without producing an installer:

```sh
pnpm tauri dev
```

### Pointing at a server

By default the client starts in offline mode. To connect to a real Grindshell server, copy `.env.example` to `.env.development` (or `.env.production` for builds) and set:

| Variable | Meaning |
|---|---|
| `VITE_UI_DEV` | `1` = offline mode (default), `0` = connect to the server |
| `VITE_API_ENDPOINT` | REST base URL for login/register, e.g. `http://localhost:8080/api` |
| `VITE_WS_ENDPOINT` | WebSocket URL for the game connection, e.g. `ws://localhost:8080/ws` |
| `VITE_CF_TURNSTILE_SITEKEY` | Cloudflare Turnstile sitekey for the login CAPTCHA; if unset, the widget is skipped (fine for local dev) |

All variables are optional; defaults are defined in [src/lib/config.ts](src/lib/config.ts).

## Development

### Tech stack

- **UI**: SolidJS + TypeScript, built with Vite
- **Styling**: TailwindCSS 4 + DaisyUI 5
- **Routing**: `@solidjs/router` (`HashRouter`) over a shared layout shell (sidebar, top bar, chat panel)
- **Desktop shell**: Tauri 2 (Rust)
- **Server communication**: plain HTTP + WebSocket directly to the backend — the Tauri layer is just the window; everything works in a browser too

### Commands

```sh
pnpm install            # install dependencies
pnpm dev                # Vite dev server only, in-browser (port 1420)
pnpm tauri dev          # full desktop shell + dev server
pnpm typecheck          # tsc --noEmit
pnpm build              # production web build → dist/
pnpm tauri build        # bundle the desktop app
```

If you use [mask](https://github.com/jacobdeichert/mask), `maskfile.md` wraps the same flows: `mask run desktop` / `mask run web`, `mask build desktop` / `mask build web`.

### Code layout

```
src/
  App.tsx             router + auth gate + theme bootstrap
  Layout.tsx          app shell: sidebar, top bar, routed content, chat panel
  routes.tsx          the single route table (path → page component)
  components/         shared UI (sidebar, top bar, chat panel, inputs, …)
  pages/
    LoginRegister.tsx auth gate (lives outside the router)
    game/             one component per route; overview/ holds the card dashboard
  lib/                data layer: config, auth, REST client, WebSocket
                      connection, wire protocol types, game context
src-tauri/            Tauri desktop shell
```

Wire types in [src/lib/protocol.ts](src/lib/protocol.ts) mirror the backend's actual message shapes — the client never models server features that don't exist yet, which is why some pages are placeholders.

For conventions, architecture detail, and the rules for growing the data layer, see [CLAUDE.md](CLAUDE.md).

## License

AGPL-3.0
