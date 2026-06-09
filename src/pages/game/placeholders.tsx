import { PagePlaceholder } from "./PagePlaceholder";

// Routes whose real content depends on the live game data layer that isn't
// ported yet. Each is a themed "not yet wired" page (see CLAUDE.md §6) rather
// than invented game data.

export const Area = () => (
  <PagePlaceholder
    title="Area"
    icon="MapPin"
    blurb="The zone map, points of interest, and what's around you will live here once world state streams in."
  />
);

export const GlobalMarket = () => (
  <PagePlaceholder
    title="Global Market"
    icon="Scale"
    blurb="Buy and sell orders across the server. Needs the live market feed before it can show real listings."
  />
);

export const Profile = () => (
  <PagePlaceholder
    title="Profile"
    icon="Identification"
    blurb="Your character sheet, account details, and progression — pending the player data layer."
  />
);

export const Rankings = () => (
  <PagePlaceholder
    title="Rankings"
    icon="NumberedList"
    blurb="Server leaderboards. Waiting on the rankings endpoint."
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
