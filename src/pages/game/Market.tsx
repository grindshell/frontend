import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { useGame, type InventoryState } from "../../lib/game-context";
import type { GoodInfo, OrderView } from "../../lib/protocol";
import { Icon } from "../../components/Icon";

// The global market (markets.md): a price-time-priority order book over the
// fungible tradeable goods. Pick a good on the left; its order book, a
// buy/sell form, a direct-buy shortcut, and your resting orders for it surface
// on the right. Buyers pay no fee; sellers pay a 1% listing fee (charged up
// front, non-refundable) plus a 4% transaction fee per fill. Everything is
// server-authoritative — nothing is applied optimistically, the ack rides with
// fresh inventory + book + order snapshots. The market needs live server state,
// so offline it shows an empty state rather than invented orders.

const MAX_ORDERS = 16; // mirrors the backend per-market cap (markets.md "Order limits")
const LISTING_FEE_PCT = 1;

const fmt = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

/** The player's holding of `good`, routed to the right slot of the inventory
 * snapshot (mirrors the backend's `good_balance`). Credits are not a good. */
function goodBalance(inv: InventoryState | null, good: string): number {
  if (!inv) return 0;
  switch (good) {
    case "dust":
      return inv.currencies.dust;
    case "rousing_devices":
      return inv.currencies.rousingDevices;
    case "bio":
      return inv.general.bio;
    case "met":
      return inv.general.met;
    case "ele":
      return inv.general.ele;
    case "liq":
      return inv.general.liq;
    default:
      return inv.items.find((s) => s.id === good)?.qty ?? 0;
  }
}

/** A short tag for a good's class, for the picker. */
const KIND_LABEL: Record<string, string> = {
  currency: "currency",
  general: "general",
  resource: "resource",
  consumable: "consumable",
};

export function Market() {
  const game = useGame();
  const market = () => game.world.market;
  const inv = () => game.world.inventory;

  const [params] = useSearchParams();
  const [selected, setSelected] = createSignal<string | null>(null);
  const [side, setSide] = createSignal<"buy" | "sell">("buy");
  const [qty, setQty] = createSignal("");
  const [price, setPrice] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  // Request the goods catalog + the player's orders when we come online.
  createEffect(() => {
    if (game.online()) {
      game.listMarketGoods();
      game.listMyOrders();
    }
  });

  // A `?good=` query param (e.g. from an Overview market card) preselects that
  // good once it's in the catalog — overriding the first-good default.
  createEffect(() => {
    const good = typeof params.good === "string" ? params.good : null;
    if (good && market()?.goods.some((g) => g.id === good)) setSelected(good);
  });

  // Default the selection to the first good once the catalog arrives.
  createEffect(() => {
    const goods = market()?.goods;
    if (goods && goods.length > 0 && !selected()) setSelected(goods[0].id);
  });

  // Pull the order book for the selected good whenever it changes.
  createEffect(
    on(selected, (good) => {
      setError(null);
      if (good && game.online()) game.viewMarket(good);
    }),
  );

  const selectedGood = (): GoodInfo | null =>
    market()?.goods.find((g) => g.id === selected()) ?? null;

  // The book the server pushed, but only when it matches the current selection
  // (a stale push from a previous good is ignored until the fresh one lands).
  const book = () => {
    const b = market()?.book;
    return b && b.good === selected() ? b : null;
  };

  const myOrders = () => market()?.myOrders ?? [];
  const ordersForGood = createMemo(() => myOrders().filter((o) => o.good === selected()));

  const balance = () => goodBalance(inv(), selected() ?? "");
  const credits = () => inv()?.currencies.credits ?? 0;

  const qtyN = () => Math.max(0, Math.floor(Number(qty()) || 0));
  const priceN = () => Math.max(0, Math.floor(Number(price()) || 0));
  const total = () => qtyN() * priceN();
  // The 1% listing fee is per-unit (floor), charged only on sells.
  const listingFee = () => Math.floor((priceN() * LISTING_FEE_PCT) / 100) * qtyN();

  const bestAsk = () => book()?.asks[0]?.price ?? null;

  const resetForm = () => {
    setQty("");
    setPrice("");
  };

  const place = () => {
    const good = selected();
    if (!good || qtyN() <= 0 || priceN() <= 0) {
      setError("enter a positive quantity and price");
      return;
    }
    setError(null);
    const onErr = (reason?: string) => setError(reason ?? "the order was rejected");
    if (side() === "buy") game.placeBuyOrder(good, qtyN(), priceN(), onErr);
    else game.placeSellOrder(good, qtyN(), priceN(), onErr);
    resetForm();
  };

  const buyNow = () => {
    const good = selected();
    const ceiling = priceN() > 0 ? priceN() : bestAsk();
    if (!good || qtyN() <= 0 || !ceiling) {
      setError("set a quantity (and optionally a max price) to buy off the book");
      return;
    }
    setError(null);
    game.buyDirect(good, qtyN(), ceiling, (reason) => setError(reason ?? "nothing to buy at that price"));
    resetForm();
  };

  const cancel = (id: number) => {
    setError(null);
    game.cancelOrder(id, (reason) => setError(reason ?? "could not cancel"));
  };

  return (
    <section class="size-full flex flex-col" data-screen-label="Market">
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Global Market</h1>
        <span class="text-xs text-base-content/45">// buy and sell on the order book</span>
        <span class="ml-auto text-xs text-base-content/55 font-mono">
          {fmt(credits())} cr · {myOrders().length}/{MAX_ORDERS} orders
        </span>
      </header>

      <Show
        when={market()}
        fallback={
          <div class="grow flex flex-col items-center justify-center text-center gap-3 text-base-content/50">
            <Icon name="Scale" class="size-10 opacity-40" />
            <p class="max-w-xs text-sm">
              The market streams from the server. Connect to browse the order
              book and place buy or sell orders.
            </p>
          </div>
        }
      >
        <div class="grow flex flex-col md:flex-row gap-4 overflow-y-auto md:overflow-hidden">
          {/* Goods picker — a sidebar list on desktop, a dropdown on mobile. */}
          <aside class="hidden md:flex w-60 shrink-0 flex-col rounded-box bg-base-200/40 overflow-hidden">
            <div class="px-3 py-2 text-[0.65rem] uppercase tracking-wide text-base-content/50 border-b border-base-content/10">
              Goods
            </div>
            <div class="overflow-y-auto grow">
              <For each={market()?.goods ?? []}>
                {(g) => (
                  <button
                    class="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-base-100/50 border-b border-base-content/5"
                    classList={{ "bg-primary/15 ring-1 ring-inset ring-primary/40": g.id === selected() }}
                    onClick={() => setSelected(g.id)}
                  >
                    <div class="min-w-0 grow">
                      <div class="text-sm font-medium truncate">{g.name}</div>
                      <div class="text-[0.65rem] text-base-content/45">{KIND_LABEL[g.kind] ?? g.kind}</div>
                    </div>
                    <span class="font-mono text-xs text-base-content/60 shrink-0">
                      {fmt(goodBalance(inv(), g.id))}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </aside>

          {/* Selected good */}
          <div class="grow min-w-0 flex flex-col gap-3 md:overflow-y-auto pr-1">
            {/* Mobile goods selector (the desktop sidebar list is hidden). */}
            <select
              class="select select-sm w-full md:hidden"
              value={selected() ?? ""}
              onChange={(e) => setSelected(e.currentTarget.value)}
            >
              <For each={market()?.goods ?? []}>
                {(g) => (
                  <option value={g.id}>
                    {g.name} · {fmt(goodBalance(inv(), g.id))}
                  </option>
                )}
              </For>
            </select>
            <Show
              when={selectedGood()}
              fallback={<p class="text-sm text-base-content/45 px-1">Pick a good to trade.</p>}
            >
              {(g) => (
                <>
                  <div class="flex items-baseline gap-3 px-1">
                    <h2 class="text-lg font-semibold">{g().name}</h2>
                    <span class="text-xs text-base-content/55 font-mono">
                      you hold {fmt(balance())}
                    </span>
                  </div>

                  {/* Order book depth — bids over asks on mobile. */}
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <BookSide title="Bids" tone="success" levels={book()?.bids ?? []} empty="No buyers yet." />
                    <BookSide title="Asks" tone="error" levels={book()?.asks ?? []} empty="No sellers yet." />
                  </div>

                  {/* Order form */}
                  <div class="rounded-box bg-base-200/50 p-3 flex flex-col gap-3">
                    <div class="join">
                      <button
                        class="btn btn-sm join-item"
                        classList={{ "btn-primary": side() === "buy" }}
                        onClick={() => setSide("buy")}
                      >
                        Buy
                      </button>
                      <button
                        class="btn btn-sm join-item"
                        classList={{ "btn-primary": side() === "sell" }}
                        onClick={() => setSide("sell")}
                      >
                        Sell
                      </button>
                    </div>

                    <div class="flex flex-wrap items-end gap-3">
                      <label class="flex flex-col gap-1">
                        <span class="text-[0.65rem] uppercase tracking-wide text-base-content/50">Quantity</span>
                        <input
                          class="input input-sm input-bordered w-28 font-mono"
                          type="number"
                          min="1"
                          value={qty()}
                          onInput={(e) => setQty(e.currentTarget.value)}
                          placeholder="0"
                        />
                      </label>
                      <label class="flex flex-col gap-1">
                        <span class="text-[0.65rem] uppercase tracking-wide text-base-content/50">Price / unit</span>
                        <input
                          class="input input-sm input-bordered w-28 font-mono"
                          type="number"
                          min="1"
                          value={price()}
                          onInput={(e) => setPrice(e.currentTarget.value)}
                          placeholder="cr"
                        />
                      </label>
                      <div class="text-xs text-base-content/60 font-mono flex flex-col gap-0.5 pb-1">
                        <span>total {fmt(total())} cr</span>
                        <Show
                          when={side() === "sell"}
                          fallback={<span class="text-base-content/40">buyers pay no fee</span>}
                        >
                          <span class="text-warning">listing fee {fmt(listingFee())} cr</span>
                        </Show>
                      </div>
                    </div>

                    <div class="flex flex-wrap gap-2">
                      <button class="btn btn-sm btn-primary" onClick={place}>
                        Place {side()} order
                      </button>
                      <Show when={side() === "buy"}>
                        <button class="btn btn-sm btn-outline" onClick={buyNow} title="Fill against the cheapest asks now">
                          Buy off the book
                        </button>
                      </Show>
                    </div>

                    <Show when={error()}>
                      <p class="text-xs text-error">✗ {error()}</p>
                    </Show>
                  </div>

                  {/* Your resting orders for this good */}
                  <div class="rounded-box bg-base-200/40 p-3">
                    <div class="text-[0.65rem] uppercase tracking-wide text-base-content/50 mb-2">
                      Your orders · {g().name}
                    </div>
                    <Show
                      when={ordersForGood().length > 0}
                      fallback={<p class="text-[0.7rem] text-base-content/45">No resting orders for this good.</p>}
                    >
                      <OrderList orders={ordersForGood()} onCancel={cancel} />
                    </Show>
                  </div>
                </>
              )}
            </Show>

            {/* All resting orders (the per-market cap counts these) */}
            <div class="rounded-box bg-base-200/40 p-3 mt-auto">
              <div class="flex items-center justify-between mb-2">
                <span class="text-[0.65rem] uppercase tracking-wide text-base-content/50">
                  All your orders
                </span>
                <span class="text-[0.65rem] font-mono text-base-content/50">
                  {myOrders().length}/{MAX_ORDERS}
                </span>
              </div>
              <Show
                when={myOrders().length > 0}
                fallback={<p class="text-[0.7rem] text-base-content/45">No active orders.</p>}
              >
                <OrderList orders={myOrders()} onCancel={cancel} showGood />
              </Show>
            </div>
          </div>
        </div>
      </Show>
    </section>
  );
}

/** One side of the order book: aggregated price levels, best price first. */
function BookSide(props: {
  title: string;
  tone: "success" | "error";
  levels: { price: number; qty: number }[];
  empty: string;
}) {
  return (
    <div class="rounded-box bg-base-200/40 overflow-hidden">
      <div
        class="px-3 py-1.5 text-[0.65rem] uppercase tracking-wide border-b border-base-content/10"
        classList={{ "text-success": props.tone === "success", "text-error": props.tone === "error" }}
      >
        {props.title}
      </div>
      <Show
        when={props.levels.length > 0}
        fallback={<p class="px-3 py-2 text-[0.7rem] text-base-content/40">{props.empty}</p>}
      >
        <table class="table table-xs">
          <thead>
            <tr class="text-base-content/45">
              <th>Price</th>
              <th class="text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.levels}>
              {(l) => (
                <tr>
                  <td class="font-mono">{fmt(l.price)}</td>
                  <td class="font-mono text-right">{fmt(l.qty)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}

/** A list of the player's orders with cancel buttons. */
function OrderList(props: { orders: OrderView[]; onCancel: (id: number) => void; showGood?: boolean }) {
  return (
    <table class="table table-xs">
      <thead>
        <tr class="text-base-content/45">
          <Show when={props.showGood}>
            <th>Good</th>
          </Show>
          <th>Side</th>
          <th class="text-right">Price</th>
          <th class="text-right">Qty</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <For each={props.orders}>
          {(o) => (
            <tr>
              <Show when={props.showGood}>
                <td class="font-mono">{o.good}</td>
              </Show>
              <td>
                <span
                  class="badge badge-xs"
                  classList={{ "badge-success": o.side === "buy", "badge-error": o.side === "sell" }}
                >
                  {o.side}
                </span>
              </td>
              <td class="font-mono text-right">{fmt(o.price)}</td>
              <td class="font-mono text-right">{fmt(o.qty)}</td>
              <td class="text-right">
                <button class="btn btn-xs btn-ghost text-error" onClick={() => props.onCancel(o.id)}>
                  cancel
                </button>
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}
