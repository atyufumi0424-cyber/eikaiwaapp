"use client";

import { useEffect, useState } from "react";
import { controlRequest, notificationDeviceId } from "./speakup-control";

type Status = {
  settings?: { maintenance_enabled: boolean; maintenance_title: string; maintenance_message: string };
  vapidPublicKey?: string;
};

export default function AppServices() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pushState, setPushState] = useState<"checking" | "off" | "on" | "unsupported">("checking");
  const [pushBusy, setPushBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [path, setPath] = useState("");

  useEffect(() => {
    setPath(location.pathname);
    let active = true;
    const load = () => controlRequest({ action: "status" }).then((value) => active && setStatus(value)).catch(() => undefined);
    load();
    const timer = window.setInterval(load, 30000);
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) setPushState("unsupported");
    else navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).then((subscription) => setPushState(subscription ? "on" : "off")).catch(() => setPushState("off"));
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  async function togglePush() {
    if (pushBusy || pushState === "unsupported") return;
    setPushBusy(true); setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) {
        await controlRequest({ action: "unsubscribe", deviceId: notificationDeviceId() });
        await current.unsubscribe();
        localStorage.removeItem("speakup-streak-push");
        setPushState("off"); setMessage("連続学習通知をオフにしました。");
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("通知が許可されませんでした。端末の通知設定をご確認ください。");
        const latest = status || await controlRequest({ action: "status" });
        if (!latest.vapidPublicKey) throw new Error("通知を準備できませんでした。");
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64Key(latest.vapidPublicKey) });
        await controlRequest({ action: "subscribe", deviceId: notificationDeviceId(), subscription: subscription.toJSON() });
        localStorage.setItem("speakup-streak-push", "on");
        setPushState("on"); setMessage("連続学習が途切れそうな日にだけ通知します。");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "通知設定に失敗しました。"); }
    finally { setPushBusy(false); }
  }

  const isAdmin = path.startsWith("/admin");
  if (isAdmin) return null;
  if (status?.settings?.maintenance_enabled) return <main className="maintenanceScreen"><div className="maintenanceOrb">🔧</div><span>SPEAKUP! SYSTEM</span><h1>{status.settings.maintenance_title}</h1><p>{status.settings.maintenance_message}</p><small>この画面はメンテナンス終了後に自動で戻ります。</small></main>;
  if (path.startsWith("/group")) return null;
  return <aside className={`pushWidget ${pushState === "on" ? "enabled" : ""}`}><button onClick={togglePush} disabled={pushBusy || pushState === "checking" || pushState === "unsupported"} aria-label="連続学習通知の設定"><i>{pushState === "on" ? "✓" : "🔔"}</i><span><b>{pushState === "on" ? "連続学習通知 ON" : "連続学習通知"}</b><small>{pushState === "unsupported" ? "この端末では利用できません" : pushState === "on" ? "途切れそうな日だけお知らせ" : "タップして通知をオン"}</small></span></button>{message && <p>{message}</p>}</aside>;
}

function base64Key(value: string) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}
