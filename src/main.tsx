import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./motion-upgrade.css";
import "./motion-upgrade-2.css";
import { LangProvider } from "./i18n";
import "./i18n/registry";

document.documentElement.style.setProperty(
  "--rift-bg-url",
  `url("${import.meta.env.BASE_URL}assets/rift-spire-bg.png")`,
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </React.StrictMode>,
);
