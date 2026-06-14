import { PagePlaceholder } from "./PagePlaceholder";

// Routes whose real content depends on the live game data layer that isn't
// ported yet. Each is a themed "not yet wired" page (see CLAUDE.md §6) rather
// than invented game data. (The Area/map page graduated to live data — see
// pages/game/Area.tsx.)

export const GlobalMarket = () => (
  <PagePlaceholder
    title="Global Market"
    icon="Scale"
    blurb="Buy and sell orders across the server. Needs the live market feed before it can show real listings."
  />
);

export const TimeTracker = () => (
  <PagePlaceholder
    title="Time Tracker"
    icon="Battery50"
    blurb="A dev/utility view carried over from the old client. Will return when its data source is wired."
  />
);

export const ResourceEditor = () => (
  <PagePlaceholder
    title="Resource Editor"
    icon="AdjustmentsHorizontal"
    blurb="A dev/utility view carried over from the old client. Will return when its data source is wired."
  />
);
