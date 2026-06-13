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
  actually wired today: **auth, chat, idle actions (combat), inventory, roster/gear, and
  consumables/effects**; see §6 for the data layer and exactly which contracts are real.

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
    TopBar.tsx        current-action indicator (kind + KC progress) + chat show/hide toggle
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
- **Routes** (ported from `frontend-old/src/routes.ts`, plus `/inventory`):
  `/` Overview · `/actions` · `/area` · `/formation` · `/inventory` · `/global-market` ·
  `/profile` · `/rankings` · `/time-tracker` · `/resource-editor` · `/about` · `/settings`.
- **Page fidelity**: pages backed by live server state render it for real — Actions
  (idle combat + travel), Inventory (holdings/gear/effects), Formation (the roster, the
  two-column [unit detail inspector](src/pages/game/UnitDetail.tsx) — prev/next roster paging,
  generated 8×8 pixel portraits ([PixelPortrait](src/components/PixelPortrait.tsx), the
  canon-pinned placeholder derivation of content-format.md "Portraits and visual identity",
  seeded `unit:<id>` / `gear:<template>` / `skill:<id>`), a left section list expanding
  Stats & Skills (contribution-matrix hover text — stats.md keeps stats label-free, so no
  invented flavor; click a skill for the lower info view) / Gear (stacked equipped/inventory
  with drag-to-equip/unequip over the real ops) / Metadata (placeholder, wire doesn't serve
  it) into the right column — and the live 5x5 grid editor over the `formation`
  snapshot — on the shared `CellGrid`/Gridstack grid, drag to move/swap), Area (the zone map:
  the discovered/frontier gridmap over that same shared grid, with clickable adjacent travel),
  [Market](src/pages/game/Market.tsx) (the live global market — a goods picker over the
  tradeable-goods catalog with per-good balances, the order-book depth, a buy/sell form with a
  live total + listing-fee preview, buy-direct, and the player's own orders with cancel; the
  16-order cap and credits show in the header), chat, and self-contained
  pages (About, theme Settings). Pages whose backing surface the backend doesn't serve yet
  (profile/rankings, …) are **themed placeholders** (`PagePlaceholder`) — they are
  intentionally not faked with invented game data. Don't invent server/state shapes; see §6 and §7.

## 5. The Overview card system

The Overview ([src/pages/game/overview/](src/pages/game/overview)) is a 12-column CSS grid of cards, each a
condensed view of an underlying game page. It is the most built-out screen and the model for
the client's visual language.

- **Layout** is `{ order: string[], sizes: Record<id, {col,row}> }`, held in a
  `createStore` and persisted to `localStorage` (`grindshell.overview.layout.v2`).
- **Arrange mode** (header toggle) enables HTML5 drag-to-reorder (via a grip handle),
  edge/corner **resize** handles, spacers, and reset. Reorder uses the **HTML5 drag-and-drop
  API**, which WebView2 swallows unless `"dragDropEnabled": false` is set on the window in
  [tauri.conf.json](src-tauri/tauri.conf.json) — without it, reorder works in the browser but
  not in the Tauri app.
- **Navigation is header-only**: outside arrange mode, clicking a card's **header** navigates to
  its route (the header is the `role="button"` shortcut). The card **body is interactive** — its
  own controls (inputs, rows, the map grid, the action starter) handle clicks and never navigate.
- **Card registry**: [cards.tsx](src/pages/game/overview/cards.tsx) exports `CARDS` (id, title, route,
  default span, optional badge, `Body`). To add a card: append to `CARDS`.
- **Tiers**: each card `Body` switches on `tier(span)` (micro/small/medium/large by area) via
  `<Switch>/<Match>` so it re-flows live as it's resized. Keep new card bodies reactive the
  same way — don't early-return on a non-reactive read.
- Card body data: the **Action, Inventory, Formation, Map, and Activity Log** cards render live
  state from the game context (`world.action` / `world.inventory` / `world.roster` /
  `world.map` / `world.log`). Every Overview card is live; no static placeholder card content
  remains. Card bodies are also **interactive**, each reusing its page's logic:
  - **Current Action** — at the **large** tier embeds an inline starter (`ActionStarter`):
    Combat/Travel tabs + a target `<select>` (+ KC for combat) + a **Start**/**Switch** button
    (`changeAction` is an atomic stop-then-start, so the same call switches a running action). The
    large **running** view is a **two-column** layout (live action + stats | accrued + starter) so
    a wide-short large card (e.g. 6×3) fits without scrolling. Smaller tiers show the progress view.
  - **Map** — a draggable mini-map on the shared `CellGrid` (`panMode`: drag to pan, click to
    select), at small/medium/large. The **medium/large** tiers add a fixed-width **area-data panel**
    for the selected (or current) zone — name (truncated, so a long name can't resize the grid),
    x/y/z position, danger, and the player's banked **Knowledge** (`MapZoneInfo.knowledge`,
    knowledge.md) — plus a **Travel** button when the selected tile is an adjacent destination
    (`startTravel`). The **large** tier also adds Z up/down + **Recenter** controls (mirrors the
    Area page). Requests `listMap` + `listDestinations`. micro = text fallback; offline → empty.
  - **Activity Log** — auto-scrolls to the newest line (`world.log` tail) and, at medium/large,
    carries the same MUD interaction input the Actions-page log has (`logLocal`; zone
    interactions aren't served yet, so it echoes locally).
  - **Market · Buy / Sell** — the player's own resting orders by side (`world.market.myOrders`,
    a buy is a bid / a sell an ask, best price first; requests `listMyOrders`/`listMarketGoods`).
    Clicking an order row deep-links to `/global-market?good=<id>` (the Market page reads the
    `good` search param to preselect). Empty state with no orders / offline.
  - **Formation** — clicking a unit row deep-links to `/formation?unit=<id>` (the Formation page
    reads the `unit` search param to open that unit's detail inspector).

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
- **Read-request throttle** (game-context `sendRead`): informational requests (`listMap`,
  `listEnemies`, `listDestinations`, the market reads, gear/mod-log pages, …) are de-duplicated
  for 10s, keyed by request identity *including* the args that change the answer (zone, good,
  page) — rapid sidebar switching re-renders from the already-held store instead of burning the
  server's per-connection inbound budget (`WS_INBOUND_RATE_LIMIT_MAX`). Single-slot stores that
  keep only the latest answer (the market book, the gear page) pass a `holds` check so a request
  whose answer was overwritten is **never** suppressed. Mutations are never throttled; stamps
  clear on disconnect. Route new read ops through `sendRead`, mutations through `send`.
- **Chat**: send/join/leave/create rooms, DMs, moderation (`ClientData`); receive
  `chatRoomMsg` / `chatDm` / `chatSystem` / `ack` / `nack` (`ServerMessage`). The context
  normalizes these into per-room `ChatEntry[]` the ChatPanel renders. Built-in rooms
  (`global`/`main`/`help`/`trade`) come from chat.md canon.
- **Idle actions (combat only)**: the game half of the connect-time state push
  (`gameState`: zone + in-flight `ActionView`), zone enemy listings (`listEnemies` →
  `enemyList`, cached per zone in the context), `changeAction` (atomic stop-then-start per
  actions.md) / `stopAction`, per-tick `actionTick` **deltas** (absent fields unchanged;
  folded over the `gameState` baseline), and the final `actionRewards`. The `ActionView`'s
  lifecycle fields (KC, phase, formation pool, stats/modifier/tally) are kind-agnostic;
  the kind-specific slice nests under its key (`combat` — enemy id/name/pool/stats), and
  `actionTick` is a flat delta union whose `attacks`/`enemy*` fields fold into that slice.
  The context keeps this in `world` (zone, action, enemy cache, reward report, action log);
  the Actions page and TopBar render it.
- **Inventory** (INVENTORY_IMPL.md Phase 1): the `inventory` push is the **authoritative
  holdings snapshot** — currencies (`credits`/`dust`/`rousingDevices`), the four bulk general
  resources (`bio`/`met`/`ele`/`liq`), and fungible item stacks (`ItemStackView`, display
  fields resolved server-side). Pushed at connect, on `requestState`, and after every commit
  (Resolution / manual stop); the client **replaces** `world.inventory` wholesale — per-tick
  tallies are narration, never accumulation. `RewardsView` (the tally) shares the same
  currency/general/item-stack shapes. Rendered by the sidebar resources quick view, the
  Overview Inventory card, and the [Inventory page](src/pages/game/Inventory.tsx).

- **Roster & gear** (INVENTORY_IMPL.md Phase 2): the `roster` push is the authoritative unit
  snapshot (`UnitView`: trained vs effective stats, trained skills, the **resolved merged
  skill list** (`resolvedSkills`: each dispatched skill in processing order with display name,
  description, effective value, and override-conflict flag — the canon-required build inspector,
  skills.md §"Player visibility"; server-computed via the kernel against the live registry,
  empty until skill content exists), and equipped `GearView`s),
  replaced wholesale like the inventory; the inventory snapshot carries the **unequipped**
  gear instances. `equipGear`/`unequipGear` ops are instance-id addressed; nothing is applied
  optimistically — the ack rides with fresh inventory + roster snapshots. `GearView.requirements`
  lets the client preview equippability with the **cheap stat check only** (vs trained levels;
  items.md — the server is authoritative and the script hook is never previewed). Rendered by
  the Inventory page's gear section + Units & equipment panel, and by the unit detail view's
  Gear section (drag between the equipped/inventory zones, or the detail-panel buttons). The
  stat display helpers are shared in [lib/stats.ts](src/lib/stats.ts); formation-grid canon
  constants in [lib/formation.ts](src/lib/formation.ts).

- **Consumables & formation effects** (INVENTORY_IMPL.md Phase 3): the `useConsumable` op
  applies a consumable's Zone Effect to the player's own formation (the only `target` the server
  implements; `zone`/`world` nack); the server acks with fresh `inventory` + `effects` snapshots.
  The `effects` push is the authoritative set of active **formation-scoped** Zone Effects
  (`EffectView`: `summary` + `remainingSecs` baseline), replaced wholesale; pushed at connect,
  resync, after a use, and on expiry. `world.effects` holds it; the Inventory page renders Use
  buttons on consumables and an **Active effects** panel that counts the timer down locally from
  the server baseline.

- **Formation editing** (formations.md "Editing the formation"): the `formation` push is the
  authoritative layout snapshot (`FormationSlotView[]`: roster unit id + 5x5 grid cell),
  replaced wholesale; pushed at connect, on `requestState`, and after a successful edit. The
  `setFormation` op sends the **whole layout** — validated atomically server-side (in-grid,
  roster units only, no cell/unit twice; an empty layout is valid but can't start actions) and
  nacked in full otherwise; nothing is applied optimistically. Edits are allowed mid-action but
  take effect at the next Preparation (the in-flight action keeps its cached stats). The
  Formation page's grid editor renders it (right column = the leading side, per canon).

- **Zone map** (zones-and-travel.md "Map visibility"): the `listMap` request is answered with a
  `mapView` push — the player's `current` zone plus every visible zone (the discovered region and
  its one-step frontier), each flagged `discovered`. The client replaces `world.map` wholesale; the
  [Area page](src/pages/game/Area.tsx) renders it on the shared `CellGrid` (Gridstack — the same
  component the editor's tile map uses, now the **`@grindshell/ui-components`** package consumed via
  pnpm `link:`, [../ui-components/CLAUDE.md](../ui-components/CLAUDE.md); edit it there, not here) one
  X/Y plane at a time with a Z toggle. Clicking a zone **only selects** it — the selected zone's
  details surface in the side panel (name, position, discovered/frontier/current status, danger),
  with a Travel button when it's an adjacent destination; clicking empty space clears the
  selection, and arriving at a new zone clears it too. A left-drag anywhere — **including on a
  zone tile** — pans the viewport (the map uses CellGrid's `panMode`, since zones aren't
  rearrangeable; a plain `disableDrag` would only pan from empty cells); a click without a drag
  still selects, gated by CellGrid's pan threshold. Travel is started only from the explicit
  buttons (the selected-zone card or the destination list), reusing `changeAction:travel`.
  Frontier zones carry the same name + danger the travel destination picker exposes.

**Not present on the wire** (so not modeled here): zone/world consumable
scopes, harvesting/crafting actions, profile/rankings. When those land, add their message
variants to `protocol.ts` and grow the context; until then those pages stay on local placeholder
data.

**Global market** (markets.md, served today): `listMarketGoods`/`viewMarket`/`listMyOrders` reads
and `placeBuyOrder`/`placeSellOrder`/`buyDirect`/`cancelOrder` mutations, answered by
`marketGoods` (the tradeable-goods catalog — fungibles only: general resources, dust/rousing
devices, item-resources, consumables; credits + gear excluded), `marketBook` (aggregated
bid/ask depth + the player's own orders for a good), and `marketOrders` (all the player's active
orders). Mutations ack with fresh inventory + book + order snapshots (nothing optimistic);
`world.market` holds `{ goods, book, myOrders }`. Sellers pay a 1% listing fee + 4% transaction
fee into the buyback fund; buyers pay nothing. The **Overview Market · Buy/Sell cards** render
the player's own orders by side from `world.market.myOrders` (there's no all-goods public book on
the wire, so the Overview condenses what's server-served without a selected good).

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
  mirror the backend's real serde definitions: auth, chat, the idle-combat action lifecycle
  (`gameState`/`actionTick`/`actionRewards`/enemy listings), inventory, roster/gear (incl. the
  resolved-skill build inspector on `UnitView`), consumables/effects, formation editing, and the
  global market (`marketGoods`/`marketBook`/`marketOrders`) — the backend serves all of these
  today. Anything the backend doesn't yet serve (local markets, multiplayer/boss combat,
  per-unit combat-stat
  *projection* of an idle formation) is **not** modeled — when a page needs that data, surface
  the need rather than hardcoding a fake shape. The canonical data model is decided in
  `knowledge-base/` and implemented server-side first; grow the data layer to match the
  backend, not ahead of it.
- Run `pnpm typecheck` before considering a change done. `tsconfig` is strict
  (`noUnusedLocals`/`noUnusedParameters` on).
- Solid idioms: `class` not `className`; `<For>`/`<Index>` over `.map`; `<Show>`/`<Switch>`
  for conditionals; inline `style` objects use kebab-case CSS keys
  (`{ "grid-column": … }`). Store/signal reads must happen inside JSX/effects to stay reactive.
- Theme is applied to `<html data-theme>` and persisted via [src/lib/theme.ts](src/lib/theme.ts);
  the Settings page is the editing surface. The theme list must stay in sync with the
  `@plugin "daisyui" { themes: … }` block in [src/App.css](src/App.css).
