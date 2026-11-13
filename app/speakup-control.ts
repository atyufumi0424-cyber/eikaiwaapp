export const SPEAKUP_SUPABASE_URL = "https://xmmlepiluiqblcgyqcsu.supabase.co";
export const SPEAKUP_PUBLISHABLE_KEY = "sb_publishable_JJ8qkOf29cviYKfK9WEf_Q_zkpF_0-Y";
export const SPEAKUP_CONTROL_URL = `${SPEAKUP_SUPABASE_URL}/functions/v1/speakup-control`;

export function notificationDeviceId() {
  let id = localStorage.getItem("speakup-notification-device-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("speakup-notification-device-id", id);
  }
  return id;
}

export async function controlRequest(body: Record<string, unknown>, token?: string) {
  const response = await fetch(SPEAKUP_CONTROL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SPEAKUP_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "サーバーとの通信に失敗しました。");
  return result;
}

export async function recordLearningActivity() {
  if (typeof window === "undefined" || localStorage.getItem("speakup-streak-push") !== "on") return;
  await controlRequest({ action: "activity", deviceId: notificationDeviceId() }).catch(() => undefined);
}
