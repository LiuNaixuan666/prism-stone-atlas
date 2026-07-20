import React from "react";
import { createRoot } from "react-dom/client";
import { PrismAtlas } from "../app/PrismAtlas";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PrismAtlas user={null} cloudEnabled={false} />
  </React.StrictMode>,
);
