import React from "react";
import { createRoot } from "react-dom/client";
import "./storage.js";
import Tracker from "./Tracker.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Tracker />
  </React.StrictMode>
);
