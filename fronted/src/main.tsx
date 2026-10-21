import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { startViewport } from "./viewport";
import { applyTheme, readTheme } from "./theme";
import { applyLanguage } from './i18n';
import { startSheetResize } from './sheetResize';

applyLanguage();
applyTheme(readTheme());
const stopViewport = startViewport();
const stopSheetResize = startSheetResize();
if (import.meta.hot) import.meta.hot.dispose(() => { stopViewport(); stopSheetResize(); });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
