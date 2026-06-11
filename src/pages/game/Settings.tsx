import { For, createSignal, type ParentProps } from "solid-js";
import { THEMES, loadTheme, setTheme } from "../../lib/theme";
import { clearAuth } from "../../lib/auth";

export function Settings() {
  const [theme, setThemeSignal] = createSignal(loadTheme());
  const [confirmClear, setConfirmClear] = createSignal(false);

  const changeTheme = (t: string) => {
    setThemeSignal(t as (typeof THEMES)[number]);
    setTheme(t as (typeof THEMES)[number]);
  };

  return (
    <section class="size-full flex flex-col gap-4" data-screen-label="Settings">
      <header class="flex items-baseline gap-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">Settings</h1>
        <span class="text-xs text-base-content/45">// client preferences</span>
      </header>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Tile>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Theme</legend>
            <select
              class="select select-sm w-full"
              value={theme()}
              onChange={(e) => changeTheme(e.currentTarget.value)}
            >
              <For each={[...THEMES].sort()}>
                {(t) => <option value={t}>{t}</option>}
              </For>
            </select>
            <p class="label text-base-content/45">Applies instantly and is remembered.</p>
          </fieldset>
        </Tile>

        <Tile>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Overview layout</legend>
            <button
              class="btn btn-sm btn-soft"
              onClick={() => {
                localStorage.removeItem("grindshell.overview.layout.v2");
                window.location.reload();
              }}
            >
              Reset card layout
            </button>
            <p class="label text-base-content/45">Restores the default Overview grid.</p>
          </fieldset>
        </Tile>

        <Tile>
          <fieldset class="fieldset">
            <legend class="fieldset-legend">Session</legend>
            <button class="btn btn-sm btn-soft" onClick={() => clearAuth()}>
              Sign out
            </button>
            <p class="label text-base-content/45">Returns to the login screen.</p>
          </fieldset>
        </Tile>
      </div>

      <div class="divider text-base-content/40">Danger</div>
      <Tile>
        <div class="flex flex-col items-start gap-2">
          <button
            class="btn btn-sm btn-error"
            onMouseLeave={() => setConfirmClear(false)}
            onClick={() => {
              if (confirmClear()) {
                localStorage.clear();
                window.location.reload();
              } else {
                setConfirmClear(true);
              }
            }}
          >
            {confirmClear() ? "Confirm — clear everything" : "Clear local data"}
          </button>
          <p class="text-sm text-base-content/55">
            Wipes saved theme, layout, and other local state — including your session token,
            so this also signs you out. Can help fix UI errors.
          </p>
        </div>
      </Tile>
    </section>
  );
}

function Tile(props: ParentProps) {
  return <div class="p-3 border border-base-300 rounded-xl bg-base-200">{props.children}</div>;
}
