import React from "react";
import ReactDOM from "react-dom/client";
import { AceScene } from "./three/AceScene";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AceScene />
  </React.StrictMode>
);
