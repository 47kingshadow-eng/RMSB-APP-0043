import { useEffect, useState } from "react";
import { registerSW } from "virtual:pwa-register";
interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
export function usePWA() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [installed, setInstalled] = useState(
    window.matchMedia("(display-mode: standalone)").matches,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    let registration: ServiceWorkerRegistration | undefined;
    const checkUpdate = () => {
      if (navigator.onLine) void registration?.update().catch(() => undefined);
    };
    registerSW({
      immediate: true,
      onRegisteredSW: (_url, current) => {
        registration = current;
        checkUpdate();
      },
      onOfflineReady: () => setOfflineReady(true),
      onRegisterError: (e) => setError(String(e)),
    });
    const before = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
    };
    const install = () => {
      setInstalled(true);
      setEvent(null);
    };
    const connection = () => {
      setOnline(navigator.onLine);
      checkUpdate();
    };
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("focus", checkUpdate);
    window.addEventListener("appinstalled", install);
    window.addEventListener("online", connection);
    window.addEventListener("offline", connection);
    return () => {
      window.removeEventListener("beforeinstallprompt", before);
      window.removeEventListener("focus", checkUpdate);
      window.removeEventListener("appinstalled", install);
      window.removeEventListener("online", connection);
      window.removeEventListener("offline", connection);
    };
  }, []);
  async function prompt() {
    if (!event) return false;
    try {
      await event.prompt();
      const result = await event.userChoice;
      if (result.outcome === "accepted") setInstalled(true);
      setEvent(null);
      return true;
    } catch {
      setEvent(null);
      return false;
    }
  }
  return { prompt, canPrompt: !!event, installed, offlineReady, online, error };
}
