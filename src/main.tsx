
  import { createRoot } from "react-dom/client";
  import "./styles/index.css";

  // The development preview does not import the Supabase-connected app.
  // This keeps local PDF review entirely independent from production sessions.
  const preview = import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "faturas";
  const root = createRoot(document.getElementById("root")!);
  async function start() {
    if (preview) {
      const { default: Preview } = await import("./app/CardStatements.tsx");
      root.render(<Preview standalone />);
    } else {
      const { default: App } = await import("./app/App.tsx");
      root.render(<App />);
    }
  }
  void start();
  
