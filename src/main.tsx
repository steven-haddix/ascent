import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./ui/App";
import { queryClient } from "./core/store/hooks";
import { pingAI } from "./core/ai/ping";
import "./ui/styles/globals.css";

// Devtools diagnostic: run `pingAI()` in the console to test a minimal request
// through the real transport (uses the stored key). Watch the [ascent:ping] logs.
(window as unknown as { pingAI: typeof pingAI }).pingAI = pingAI;

// Apply the saved theme before first paint to avoid a flash.
const savedTheme = localStorage.getItem("ascent-theme") ?? "cream";
document.documentElement.dataset.theme = savedTheme;
document.documentElement.classList.toggle("dark", savedTheme === "dark");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
