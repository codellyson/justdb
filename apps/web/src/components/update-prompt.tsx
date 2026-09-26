
import { useEffect, useState } from "react";

// Soft update prompt — appears once per session in the Tauri webview when
// tauri-plugin-updater finds a newer release manifest. User can either run
// the update (download + verify signature + install + relaunch) or dismiss
// for the rest of the session.
//
// No-op outside Tauri. Failures in check() are swallowed (logged to console)
// so a missing manifest, network blip, or pubkey mismatch doesn't break the
// app — the user just doesn't see a prompt.

interface UpdateHandle {
  version: string;
  body?: string;
  downloadAndInstall: (
    onEvent?: (e: {
      event: "Started" | "Progress" | "Finished";
      data?: { contentLength?: number; chunkLength?: number };
    }) => void,
  ) => Promise<void>;
}

type State =
  | { kind: "hidden" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; pct: number | null }
  | { kind: "error"; message: string };

export function UpdatePrompt() {
  const [state, setState] = useState<State>({ kind: "hidden" });
  const [update, setUpdate] = useState<UpdateHandle | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("@tauri-apps/plugin-updater");
        const u = await mod.check();
        if (cancelled || !u) return;
        setUpdate(u as unknown as UpdateHandle);
        setState({ kind: "available", version: u.version });
      } catch (e) {
        console.warn("[update-check]", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runUpdate = async () => {
    if (!update) return;
    setState({ kind: "downloading", version: update.version, pct: null });
    try {
      let total = 0;
      let got = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data?.contentLength ?? 0;
        if (event.event === "Progress") {
          got += event.data?.chunkLength ?? 0;
          const pct = total > 0 ? Math.round((got / total) * 100) : null;
          setState((prev) =>
            prev.kind === "downloading" ? { ...prev, pct } : prev,
          );
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  if (state.kind === "hidden") return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-border bg-bg-secondary shadow-xl p-4 text-sm">
      {state.kind === "available" && (
        <>
          <p className="font-medium text-primary mb-1">
            Update available — v{state.version}
          </p>
          <p className="text-xs text-muted mb-3">
            Downloads in the background, then restarts JustDB.
          </p>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setState({ kind: "hidden" })}
              className="px-3 py-1 text-xs text-secondary hover:text-primary"
            >
              Later
            </button>
            <button
              onClick={runUpdate}
              className="px-3 py-1 text-xs font-medium text-[rgb(var(--accent-text))] bg-accent hover:bg-accent-hover rounded-sm"
            >
              Update now
            </button>
          </div>
        </>
      )}

      {state.kind === "downloading" && (
        <>
          <p className="font-medium text-primary mb-1">
            Downloading v{state.version}…
          </p>
          <p className="text-xs text-muted">
            {state.pct !== null
              ? `${state.pct}% — the app will restart automatically.`
              : "Starting download…"}
          </p>
        </>
      )}

      {state.kind === "error" && (
        <>
          <p className="font-medium text-danger mb-1">Update failed</p>
          <p className="text-xs text-muted mb-3">{state.message}</p>
          <button
            onClick={() => setState({ kind: "hidden" })}
            className="px-3 py-1 text-xs text-secondary hover:text-primary"
          >
            Dismiss
          </button>
        </>
      )}
    </div>
  );
}
