import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { startPixelGrid } from "./pixelGrid";
import { applyTheme, readTheme } from "./theme";

applyTheme(readTheme());
const stopPixelGrid = startPixelGrid();
if (import.meta.hot) import.meta.hot.dispose(stopPixelGrid);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
