import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import { App } from "./App.tsx";
import { PlayerScreen } from "./PlayerScreen.tsx";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URLSearchParams(location.search).get("player") === "1" ? <PlayerScreen /> : <App />}
  </StrictMode>,
);
