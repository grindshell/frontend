import type { RouteDefinition } from "@solidjs/router";
import { Overview } from "./overview/Overview";
import { Actions } from "./pages/game/Actions";
import { Formation } from "./pages/game/Formation";
import { Settings } from "./pages/game/Settings";
import { About } from "./pages/game/About";
import {
  Area,
  GlobalMarket,
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
  { path: "/global-market", component: GlobalMarket },
  { path: "/profile", component: Profile },
  { path: "/rankings", component: Rankings },
  { path: "/time-tracker", component: TimeTracker },
  { path: "/resource-editor", component: ResourceEditor },
  { path: "/about", component: About },
  { path: "/settings", component: Settings },
  // Unknown paths fall back to the Overview.
  { path: "*", component: Overview },
];
