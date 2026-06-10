import { Show } from "solid-js";
import { HashRouter } from "@solidjs/router";
import { Layout } from "./Layout";
import { Routes } from "./routes";
import { GameProvider } from "./lib/game-context";
import { LoginRegister } from "./pages/LoginRegister";
import { isAuthed } from "./lib/auth";
import { applyTheme, loadTheme } from "./lib/theme";
import "./App.css";

// Apply the saved theme before first paint.
applyTheme(loadTheme());

function App() {
  // Auth gate: until there's a session token (or an offline dev session), the
  // login screen stands in front of the game. Reactive on the auth signals.
  return (
    <Show when={isAuthed()} fallback={<LoginRegister />}>
      <GameProvider>
        <HashRouter root={Layout}>{Routes}</HashRouter>
      </GameProvider>
    </Show>
  );
}

export default App;
