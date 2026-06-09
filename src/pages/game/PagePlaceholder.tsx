import { Icon, type IconName } from "../../components/Icon";

// Themed placeholder for routes whose real content depends on the (not-yet-ported)
// live game data layer. Intentionally not faked with invented game data — see
// CLAUDE.md §6.
export function PagePlaceholder(props: {
  title: string;
  icon: IconName;
  blurb: string;
}) {
  return (
    <section class="size-full flex flex-col" data-screen-label={props.title}>
      <header class="flex items-baseline gap-3 mb-3 px-1">
        <h1 class="text-xl font-mono tracking-tight">{props.title}</h1>
      </header>
      <div class="flex-1 flex items-center justify-center">
        <div class="max-w-sm text-center flex flex-col items-center gap-3 text-base-content/60">
          <span class="text-base-content/30">
            <Icon name={props.icon} class="size-10" />
          </span>
          <p class="text-sm leading-relaxed">{props.blurb}</p>
          <span class="text-[10px] uppercase tracking-[0.18em] font-medium text-base-content/35">
            not yet wired
          </span>
        </div>
      </div>
    </section>
  );
}
