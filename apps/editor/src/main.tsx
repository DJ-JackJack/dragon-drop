import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import { App } from "./App.tsx";
import { Viewer } from "./Viewer.tsx";
import "./styles.css";

// /view is the read-only, phone-friendly map page; everything else is the editor.
const isViewer = location.pathname.replace(/\/+$/, "") === "/view";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isViewer ? <Viewer /> : <App />}
  </StrictMode>,
);
