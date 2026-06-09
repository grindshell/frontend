import { HashRouter } from "@solidjs/router";
import { Layout } from "./Layout";
import { Routes } from "./routes";
import { applyTheme, loadTheme } from "./lib/theme";
import "./App.css";

// Apply the saved theme before first paint.
applyTheme(loadTheme());

function App() {
  return <HashRouter root={Layout}>{Routes}</HashRouter>;
}

export default App;
