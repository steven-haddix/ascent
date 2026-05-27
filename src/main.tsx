import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App";
import "./ui/styles/globals.css";

// Apply the saved theme before first paint to avoid a flash.
const savedTheme = localStorage.getItem("ascent-theme") ?? "cream";
document.documentElement.dataset.theme = savedTheme;
document.documentElement.classList.toggle("dark", savedTheme === "dark");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
