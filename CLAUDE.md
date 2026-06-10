# CLAUDE.md

Onboarding doc for Claude / agents working on the **Grindshell game client** (`frontend/`).
This is the player-facing client for Grindshell, an in-development online multiplayer game.
For how this repo relates to its siblings (and to canon in `knowledge-base/`), see the
container [../CLAUDE.md](../CLAUDE.md). Gameplay/lore questions are decided in
`knowledge-base/` first, then implemented here.

> A previous iteration of this client lives at `../frontend-old` (its own git repo). It is
> the **reference** we are re-building from — mine it for routes/pages/behavior, but don't
> depend on it. New work goes here.

## 1. Tech stack

Mirrors the `editor/` stack on purpose (same Tauri + Solid + Tailwind + DaisyUI toolchain).

**Frontend**

- [SolidJS](https://www.solidjs.com/) `^1.9.3`
- TypeScript `~5.6.2`
- Vite `^6.0.3` (+ `vite-plugin-solid`)
- TailwindCSS `^4` (via `@tailwindcss/vite`) + DaisyUI `^5`. Configured in
  [src/App.css](src/App.css) via `@import "tailwindcss"` and `@plugin "daisyui"`.
  Default theme: `dark` (set as `data-theme` on `<html>` in [index.html](index.html)).
- [`@solidjs/router`](https://github.com/solidjs/solid-router) `^0.15` — `HashRouter`
  with a shared `root` layout. See §4.

**Backend (desktop shell)**

- Tauri `^2` (+ `tauri-plugin-opener` `^2`). Rust edition 2021. The shell is currently the
  default scaffold ([src-tauri/src/lib.rs](src-tauri/src/lib.rs)) — no game-specific
  commands yet.

**Server (the `../backend` Rust workspace)**

- The client talks to the backend directly over HTTP + WebSocket (not through Tauri). What's
  actually wired today is **auth + chat only**; see §6 for the data layer and exactly which
  contracts are real.

**Tooling**

- Package manager: **pnpm** (matches `src-tauri/tauri.conf.json` `beforeDevCommand` /
  `beforeBuildCommand`). Do not switch without updating those commands.

## 2. Commands

```
pnpm install            # install JS deps
pnpm dev                # Vite dev server only (port 1420)
pnpm tauri dev          # full Tauri shell + Vite
pnpm typecheck          # tsc --noEmit (run this before calling a change done)
pnpm build              # Vite production build → dist/
pnpm tauri build        # bundle desktop app
```

A `frontend` config in the grindshell-root [../.claude/launch.json](../.claude/launch.json)
runs `pnpm -C frontend dev` on port 1420 for Claude Preview. Note: Preview reads
`launch.json` from the **grindshell root**, not this subdir.

## 3. Repo layout

```
index.html            entry; <html data-theme="dark">, mounts #root
src/
  index.tsx           render(App)
  App.tsx             <HashRouter root={Layout}>{Routes}</HashRouter> + theme bootstrap
  App.css             tailwind + daisyui import, theme list, scrollbar styling
  Layout.tsx          app shell: Sidebar + TopBar + routed content + resizable ChatPanel
  routes.tsx          RouteDefinition[] — the single route table (path → component)
  components/
    Icon.tsx          hero-icon stroked glyph set (name → SVG path)
    Sidebar.tsx       collapsible nav rail; router-driven active state + navigation
    TopBar.tsx        travel progress bar + chat show/hide toggle
    ChatPanel.tsx     channel rail + send row + transcript; consumes the game context
    TextInput.tsx     labelled input with validation-error / optional hint
    CFTurnstile.tsx   Cloudflare Turnstile widget (lazy script load, optional)
    GdprConsent.tsx   one-time "stores data locally" notice
  pages/
    LoginRegister.tsx the auth gate (login / register / forgot) — see §6
    game/             one component per route (Actions, Area, Formation, …) — see §4
      overview/
        Overview.tsx  the "/" dashboard: 12-col grid of moveable/resizeable cards
        cards.tsx     card shell registry + per-card bodies (tiered by area)
  lib/
    theme.ts          DaisyUI theme list + load/apply/persist (localStorage)
    auth.ts           global auth signals (token / offline) + sign-in/out helpers
    config.ts         runtime config from Vite env (endpoints, offline uiDev flag)
    protocol.ts       wire types mirroring the backend's serde message shapes
    api.ts            REST client (/api/login, /api/register)
    connection.ts     WebSocket manager (auth handshake, nonce check, reconnect)
    game-context.tsx  GameProvider/useGame — status + chat state + send methods
.env.example          template for VITE_* config; .env.development = local dev defaults
src-tauri/            Tauri desktop shell (default scaffold)
dist/                 Vite build output (gitignored)
```

## 4. Routing & pages

- **Router**: `HashRouter` (hash routing suits the Tauri `file://`/localhost shell). The
  route table is [src/routes.tsx](src/routes.tsx) — an array of
  `{ path, component }` (`RouteDefinition[]`) passed as children to the router in
  [App.tsx](src/App.tsx). To add a route: add a page under `src/pages/game/`, register it in
  `routes.tsx`, and (if it belongs in the nav) add it to the relevant list in `Sidebar.tsx`.
- **Layout root**: [src/Layout.tsx](src/Layout.tsx) is the router `root` — it renders the
  persistent shell (sidebar, topbar, chat) and drops the matched route into the content area
  via `props.children`. Don't wrap individual pages in the shell; the root does it once.
- **Navigation/active state**: `Sidebar` and the Overview cards use `useNavigate` /
  `useLocation` from `@solidjs/router`. There is no per-component "current route" signal —
  the URL is the source of truth.
- **Routes** (ported from `frontend-old/src/routes.ts`):
  `/` Overview · `/actions` · `/area` · `/formation` · `/global-market` · `/profile` ·
  `/rankings` · `/time-tracker` · `/resource-editor` · `/about` · `/settings`.
- **Page fidelity**: pages that were self-contained in the old client are ported with real
  behavior (About, Formation, the Actions action-selector/travel-route UI, theme Settings).
  Pages that depended on the old `game-context` (live server state) are **themed placeholders**
  for now (`PagePlaceholder`) — they are intentionally not faked with invented game data. The
  one exception is **chat**, which is real (see §6); the ChatPanel is wired to the backend.
  Don't invent server/state shapes; see §6 and §7.

## 5. The Overview card system

The Overview ([src/pages/game/overview/](src/pages/game/overview)) is a 12-column CSS grid of cards, each a
condensed view of an underlying game page. It is the most built-out screen and the model for
the client's visual language.

- **Layout** is `{ order: string[], sizes: Record<id, {col,row}> }`, held in a
  `createStore` and persisted to `localStorage` (`grindshell.overview.layout.v2`).
- **Arrange mode** (header toggle) enables HTML5 drag-to-reorder (via a grip handle),
  edge/corner **resize** handles, spacers, and reset. Outside arrange mode a card click
  navigates to its route.
- **Card registry**: [cards.tsx](src/pages/game/overview/cards.tsx) exports `CARDS` (id, title, route,
  default span, optional badge, `Body`). To add a card: append to `CARDS`.
- **Tiers**: each card `Body` switches on `tier(span)` (micro/small/medium/large by area) via
  `<Switch>/<Match>` so it re-flows live as it's resized. Keep new card bodies reactive the
  same way — don't early-return on a non-reactive read.
- Card body data is currently **static placeholder** content.

## 6. Data layer (server connection)

The client talks to `../backend` over HTTP + WebSocket. The layer lives in `src/lib/` and is
exposed through the **game context** ([game-context.tsx](src/lib/game-context.tsx)):
`GameProvider` wraps the router in [App.tsx](src/App.tsx); components call `useGame()`.

**Grounded in the real backend — do not invent contracts.** [protocol.ts](src/lib/protocol.ts)
mirrors the backend's actual serde types (cite the Rust files in its header). What the backend
serves **today**:

- **Auth** (REST, [api.ts](src/lib/api.ts)): `POST /api/login`, `POST /api/register` →
  plain-text UUID session token. Both require a Cloudflare Turnstile `cfToken`.
- **WebSocket** ([connection.ts](src/lib/connection.ts)): connect to `/ws` offering two
  subprotocols — `grindshell.auth.<token>` and a per-attempt `<nonce>`. The server echoes the
  nonce as the selected subprotocol; the client **verifies the echo and severs on mismatch**
  (accounts.md anti-hijack). Auto-reconnect with backoff.
- **Chat** (the only live gameplay surface): send/join/leave/create rooms, DMs, moderation
  (`ClientData`); receive `chatRoomMsg` / `chatDm` / `chatSystem` / `ack` / `nack`
  (`ServerMessage`). The context normalizes these into per-room `ChatEntry[]` the ChatPanel
  renders. Built-in rooms (`global`/`main`/`help`/`trade`) come from chat.md canon.

**Not present on the wire** (so not modeled here): any game-state sync — inventory, formation,
actions, combat, ticks, area. The backend accepts non-chat messages but silently drops them
server-side (the game engine isn't wired to the socket yet). When those land, add their message
variants to `protocol.ts` and grow the context; until then gameplay pages stay on local
placeholder data.

**Auth gate.** [App.tsx](src/App.tsx) shows [LoginRegister](src/pages/LoginRegister.tsx) until
the client is authenticated; only then does it mount `GameProvider` + the router. "Authed" is
tracked by global signals in [auth.ts](src/lib/auth.ts): a real session token
(`localStorage` key `grindshell.token`) **or** an offline dev session. Login/register submit to
the REST API, store the returned token via `setToken`, and the gate flips reactively;
**Settings → Sign out** calls `clearAuth` to return to the gate. Login is a **gate, not a
route** — it lives outside the router and the persistent shell. A Cloudflare Turnstile
(`cfToken`) is sent with login/register; when no `VITE_CF_TURNSTILE_SITEKEY` is configured the
widget is skipped and an empty token is sent (fine for local dev / the backend's test build).

**Offline by default.** `config.uiDev` (env `VITE_UI_DEV`, default on) runs the client with no
network — no REST, no socket — and chat **echoes locally** so the UI is usable in preview
without a server. In `uiDev` the login screen offers a **"Continue offline"** button that
enters the game without contacting the server; a real login still works if endpoints are set.
With `uiDev=0`, the context connects whenever a token is present. Note the backend has no
password-recovery endpoint yet, so the "forgot password" view is an informational stub.
Config + endpoints: [config.ts](src/lib/config.ts) / `.env.example`.

## 7. Conventions & open items

- **Git is the user's to drive.** Do **not** run mutating git commands — no `git commit`,
  `git push`, `git merge`, `git rebase`, `git reset`, branch creation, tag, or stash. The
  user handles all commits and pushes themselves. Read-only inspection (`git status`,
  `git diff`, `git log`) is fine. Leave changes in the working tree for the user to review
  and commit.
- Mirror the pinned versions in §1 when adding the deps the design names. Don't swap pnpm.
- **No invented game/server contracts.** Wire types in [protocol.ts](src/lib/protocol.ts)
  mirror the backend's real serde definitions (auth + chat). Anything the backend doesn't yet
  serve (inventory, formation, actions, combat, ticks, area) is **not** modeled — when a page
  needs that data, surface the need rather than hardcoding a fake shape. The canonical data
  model is decided in `knowledge-base/` and implemented server-side first; grow the data layer
  to match the backend, not ahead of it.
- Run `pnpm typecheck` before considering a change done. `tsconfig` is strict
  (`noUnusedLocals`/`noUnusedParameters` on).
- Solid idioms: `class` not `className`; `<For>`/`<Index>` over `.map`; `<Show>`/`<Switch>`
  for conditionals; inline `style` objects use kebab-case CSS keys
  (`{ "grid-column": … }`). Store/signal reads must happen inside JSX/effects to stay reactive.
- Theme is applied to `<html data-theme>` and persisted via [src/lib/theme.ts](src/lib/theme.ts);
  the Settings page is the editing surface. The theme list must stay in sync with the
  `@plugin "daisyui" { themes: … }` block in [src/App.css](src/App.css).
