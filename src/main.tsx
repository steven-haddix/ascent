import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./ui/App";
import { queryClient } from "./core/store/hooks";
import "./ui/styles/globals.css";
import "katex/dist/katex.min.css"; // KaTeX math styles (eager + build-resolved; see katexCore)

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
