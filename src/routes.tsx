import type { RouteDefinition } from "@solidjs/router";
import { Overview } from "./pages/game/overview/Overview";
import { Actions } from "./pages/game/Actions";
import { Area } from "./pages/game/Area";
import { Formation } from "./pages/game/Formation";
import { Inventory } from "./pages/game/Inventory";
import { Market } from "./pages/game/Market";
import { Settings } from "./pages/game/Settings";
import { About } from "./pages/game/About";
import {
  Profile,
  Rankings,
  TimeTracker,
  ResourceEditor,
} from "./pages/game/placeholders";

// The single route table. To add a route: create a page under src/pages/game/,
// register it here, and (if it belongs in the nav) add it to Sidebar.tsx.
// Ported from frontend-old/src/routes.ts.
export const Routes: RouteDefinition[] = [
  { path: "/", component: Overview },
  { path: "/actions", component: Actions },
  { path: "/area", component: Area },
  { path: "/formation", component: Formation },
  { path: "/inventory", component: Inventory },
  { path: "/global-market", component: Market },
  { path: "/profile", component: Profile },
  { path: "/rankings", component: Rankings },
  { path: "/time-tracker", component: TimeTracker },
  { path: "/resource-editor", component: ResourceEditor },
  { path: "/about", component: About },
  { path: "/settings", component: Settings },
  // Unknown paths fall back to the Overview.
  { path: "*", component: Overview },
];
