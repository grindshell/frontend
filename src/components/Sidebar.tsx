import { For, Show, createSignal } from "solid-js";
import { useLocation, useNavigate } from "@solidjs/router";
import { useGame } from "../lib/game-context";
import { Icon, type IconName } from "./Icon";

export type Route = { id: string; name: string; icon: IconName };

const ROUTES: Route[] = [
  { id: "/", name: "Overview", icon: "ViewfinderCircle" },
  { id: "/actions", name: "Actions", icon: "Battery50" },
  { id: "/area", name: "Area", icon: "MapPin" },
  { id: "/formation", name: "Formation", icon: "Users" },
  { id: "/inventory", name: "Inventory", icon: "CircleStack" },
  { id: "/global-market", name: "Global Market", icon: "Scale" },
];
const UTIL_ROUTES: Route[] = [
  { id: "/profile", name: "Profile", icon: "Identification" },
  { id: "/rankings", name: "Rankings", icon: "NumberedList" },
];
const BOTTOM_ROUTES: Route[] = [
  { id: "/settings", name: "Settings", icon: "AdjustmentsHorizontal" },
  { id: "/about", name: "About", icon: "QuestionMarkCircle" },
];

/** The collapsible resources quick view (inventory.md / resources.md): the
 * three numeric currencies plus the four bulk general resources, live from
 * the server's authoritative `inventory` push. Hidden while the rail is
 * collapsed — the Inventory nav icon stands in for it. */
function ResourcesQuickView() {
  const game = useGame();
  const navigate = useNavigate();
  const [open, setOpen] = createSignal(true);
  const cur = () => game.world.inventory?.currencies;
  const gen = () => game.world.inventory?.general;
  const fmt = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");

  const rows = () => [
    ["CR", cur()?.credits] as const,
    ["DU", cur()?.dust] as const,
    ["RO", cur()?.rousingDevices] as const,
    ["BIO", gen()?.bio] as const,
    ["MET", gen()?.met] as const,
    ["ELE", gen()?.ele] as const,
    ["LIQ", gen()?.liq] as const,
  ];

  return (
    <div class="px-1.5 py-1">
      <button
        class="w-full flex items-center justify-between px-3 py-1 rounded hover:bg-base-100/50 text-[10px] uppercase tracking-wider text-base-content/50"
        onClick={() => setOpen(!open())}
        aria-expanded={open()}
      >
        <span>Resources</span>
        <Icon name="ChevronDown" class={"size-3 transition-transform " + (open() ? "" : "-rotate-90")} />
      </button>
      <Show when={open()}>
        <ul
          class="px-3 py-1 space-y-0.5 font-mono text-xs cursor-pointer"
          title="Open the inventory"
          onClick={() => navigate("/inventory")}
        >
          <For each={rows()}>
            {([label, value]) => (
              <li class="flex justify-between gap-2">
                <span class="text-base-content/45">{label}</span>
                <span class="text-base-content/80 truncate">{fmt(value)}</span>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

export function Sidebar(props: { open: boolean; setOpen: (v: boolean) => void }) {
  const location = useLocation();
  const navigate = useNavigate();

  const Item = (p: { r: Route }) => {
    const active = () => location.pathname === p.r.id;
    return (
      <li>
        <button
          class={
            "w-full flex items-center gap-3 px-3 py-2 rounded relative text-sm text-base-content/85 " +
            (props.open ? "justify-start " : "justify-center ") +
            (active() ? "bg-base-100 font-semibold" : "hover:bg-base-100/50")
          }
          title={!props.open ? p.r.name : undefined}
          onClick={() => navigate(p.r.id)}
        >
          {active() && <span class="absolute inset-y-1 left-0 w-0.5 rounded-r bg-primary" />}
          <Icon name={p.r.icon} />
          {props.open && <span class="truncate">{p.r.name}</span>}
        </button>
      </li>
    );
  };

  return (
    <aside
      class={
        "shrink-0 bg-base-300 flex flex-col transition-[width] duration-200 " +
        (props.open ? "w-56" : "w-14")
      }
    >
      <ul class="menu w-full p-1.5">
        <li>
          <button
            onClick={() => props.setOpen(!props.open)}
            class={
              "w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-base-100/50 text-sm " +
              (props.open ? "justify-start" : "justify-center")
            }
            title={!props.open ? "Toggle sidebar" : undefined}
          >
            <Icon name="CodeBracketSquare" />
            {props.open && <span class="font-mono">Grindshell</span>}
          </button>
        </li>
      </ul>
      <div class="divider my-0 mx-2" />
      <ul class="menu w-full p-1.5 space-y-0.5">
        <For each={ROUTES}>{(r) => <Item r={r} />}</For>
      </ul>
      <div class="divider my-0 mx-2" />
      <ul class="menu w-full p-1.5 space-y-0.5">
        <For each={UTIL_ROUTES}>{(r) => <Item r={r} />}</For>
      </ul>
      <Show when={props.open}>
        <div class="divider my-0 mx-2" />
        <ResourcesQuickView />
      </Show>
      <div class="flex-1" />
      <div class="divider my-0 mx-2" />
      <ul class="menu w-full p-1.5 space-y-0.5 pb-3">
        <For each={BOTTOM_ROUTES}>{(r) => <Item r={r} />}</For>
      </ul>
    </aside>
  );
}
