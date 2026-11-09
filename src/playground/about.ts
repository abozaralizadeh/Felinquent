// The About window (ADR-062), opened from the version line at the top of the menu. The buttons ask
// the app to open the site or the code in your browser: the page itself never goes anywhere.

declare global {
  interface Window {
    FELINQUENT_VERSION?: string;
    __TAURI__?: { core: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> } };
  }
}

const SITE = "https://abozaralizadeh.github.io/Felinquent/";
const REPO = "https://github.com/abozaralizadeh/Felinquent";

const version = document.getElementById("version");
if (version) version.textContent = window.FELINQUENT_VERSION ? `Version ${window.FELINQUENT_VERSION}` : "";

function act(what: "site" | "repo" | "close" | "shown"): void {
  const tauri = window.__TAURI__;
  if (tauri) void tauri.core.invoke("about_action", { what });
  // In a browser (the playground's dev server) the links just open in a new tab.
  else if (what === "site" || what === "repo") window.open(what === "site" ? SITE : REPO, "_blank", "noopener");
}

// Tells the app the page is up (a line in the log), which also shows its buttons can reach it.
act("shown");

document.getElementById("repo")?.addEventListener("click", () => act("repo"));
document.getElementById("site")?.addEventListener("click", () => act("site"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") act("close");
});

export {};
