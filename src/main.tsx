import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

document.documentElement.style.setProperty(
  "--rift-bg-url",
  `url("${import.meta.env.BASE_URL}assets/rift-spire-bg.png")`,
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
