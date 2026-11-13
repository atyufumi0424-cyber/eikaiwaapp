"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient, Session } from "@supabase/supabase-js";
import { controlRequest, SPEAKUP_PUBLISHABLE_KEY, SPEAKUP_SUPABASE_URL } from "../speakup-control";
import "./admin.css";

const supabase = createClient(SPEAKUP_SUPABASE_URL, SPEAKUP_PUBLISHABLE_KEY);

type Dashboard = {
  admin: string;
  subscriberCount: number;
  settings: { maintenance_enabled: boolean; maintenance_title: string; maintenance_message: string };
  announcements: Array<{ id: string; title: string; body: string; kind: string; created_at: string; sent_at?: string }>;
};

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [maintenance, setMaintenance] = useState({ enabled: false, title: "メンテナンス中です", body: "より良い体験のため、現在メンテナンスを行っています。", notify: true });
  const [notice, setNotice] = useState({ title: "", body: "" });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) void loadDashboard(session); }, [session]);

  async function loadDashboard(current = session) {
    if (!current) return;
    try {
      const next = await controlRequest({ action: "admin-dashboard" }, current.access_token) as Dashboard;
      setDashboard(next);
      setMaintenance({ enabled: next.settings.maintenance_enabled, title: next.settings.maintenance_title, body: next.settings.maintenance_message, notify: true });
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "管理画面を読み込めませんでした。"); }
  }

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/admin`, shouldCreateUser: true } });
    setMessage(error ? error.message : "ログイン用メールを送りました。メール内のリンクを開いてください。");
    setBusy(false);
  }

  async function saveMaintenance() {
    if (!session) return;
    setBusy(true); setMessage("");
    try {
      const result = await controlRequest({ action: "maintenance", enabled: maintenance.enabled, title: maintenance.title, message: maintenance.body, notify: maintenance.notify }, session.access_token);
      setMessage(maintenance.enabled ? `メンテナンス画面を開始しました。${result.sent ? ` ${result.sent}台へ通知しました。` : ""}` : `通常公開に戻しました。${result.sent ? ` ${result.sent}台へ通知しました。` : ""}`);
      await loadDashboard();
    } catch (error) { setMessage(error instanceof Error ? error.message : "更新に失敗しました。"); }
    finally { setBusy(false); }
  }

  async function sendAnnouncement(event: FormEvent) {
    event.preventDefault(); if (!session) return;
    setBusy(true); setMessage("");
    try {
      const result = await controlRequest({ action: "announcement", title: notice.title, message: notice.body }, session.access_token);
      setMessage(`お知らせを保存し、${result.sent}台へ通知しました。`); setNotice({ title: "", body: "" }); await loadDashboard();
    } catch (error) { setMessage(error instanceof Error ? error.message : "通知の送信に失敗しました。"); }
    finally { setBusy(false); }
  }

  if (!session) return <main className="adminShell"><section className="adminLogin"><span>SPEAKUP! CONTROL ROOM</span><h1>運営ログイン</h1><p>登録済みの管理者メールアドレスに、安全なログインリンクを送ります。</p><form onSubmit={login}><label>管理者メール<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="name@example.com" /></label><button disabled={busy}>{busy ? "送信中…" : "ログインリンクを送る"}</button></form>{message && <div className="adminMessage">{message}</div>}<a href="/">← SpeakUp!に戻る</a></section></main>;

  return <main className="adminShell"><header className="adminHeader"><div><span>SPEAKUP! CONTROL ROOM</span><h1>運営ダッシュボード</h1></div><button onClick={() => supabase.auth.signOut()}>ログアウト</button></header>{message && <div className="adminMessage top">{message}</div>}{!dashboard ? <div className="adminLoading">管理データを読み込んでいます…</div> : <div className="adminGrid"><section className="adminCard statusCard"><span>通知登録端末</span><strong>{dashboard.subscriberCount}</strong><small>台</small><p>連続学習通知をオンにした端末数</p></section><section className={`adminCard maintenanceCard ${maintenance.enabled ? "active" : ""}`}><div className="cardTitle"><div><span>SITE CONTROL</span><h2>メンテナンスモード</h2></div><button className={`powerSwitch ${maintenance.enabled ? "on" : ""}`} onClick={() => setMaintenance({ ...maintenance, enabled: !maintenance.enabled })} aria-pressed={maintenance.enabled}><i /></button></div><label>画面タイトル<input value={maintenance.title} onChange={(event) => setMaintenance({ ...maintenance, title: event.target.value })} /></label><label>表示メッセージ<textarea value={maintenance.body} onChange={(event) => setMaintenance({ ...maintenance, body: event.target.value })} /></label><label className="checkLine"><input type="checkbox" checked={maintenance.notify} onChange={(event) => setMaintenance({ ...maintenance, notify: event.target.checked })} />切り替え時にプッシュ通知を送る</label><button className="adminPrimary" onClick={saveMaintenance} disabled={busy}>{maintenance.enabled ? "メンテナンスを開始" : "通常公開に戻す"}</button></section><section className="adminCard noticeCard"><div className="cardTitle"><div><span>BROADCAST</span><h2>運営からのお知らせ</h2></div><b>📣</b></div><form onSubmit={sendAnnouncement}><label>タイトル<input value={notice.title} onChange={(event) => setNotice({ ...notice, title: event.target.value })} required maxLength={80} /></label><label>本文<textarea value={notice.body} onChange={(event) => setNotice({ ...notice, body: event.target.value })} required maxLength={300} /></label><button className="adminPrimary" disabled={busy}>登録端末へ通知する</button></form></section><section className="adminCard historyCard"><div className="cardTitle"><div><span>HISTORY</span><h2>送信履歴</h2></div><button onClick={() => loadDashboard()}>更新</button></div><div className="noticeHistory">{dashboard.announcements.length === 0 ? <p>まだお知らせはありません。</p> : dashboard.announcements.map((item) => <article key={item.id}><i>{item.kind === "maintenance" ? "🔧" : "📣"}</i><div><b>{item.title}</b><p>{item.body}</p><small>{new Date(item.created_at).toLocaleString("ja-JP")}</small></div></article>)}</div></section></div>}<footer className="adminFooter">ログイン中: {dashboard?.admin || session.user.email}</footer></main>;
}
