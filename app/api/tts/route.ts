import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const endpoint = "https://api.groq.com/openai/v1/audio/speech";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const text = typeof body.text === "string"
      ? body.text.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 200)
      : "";
    if (!text) return NextResponse.json({ error: "読み上げる文章がありません。" }, { status: 400 });

    const keys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
      .split(/[\n,]+/).map((key) => key.trim()).filter((key) => key.startsWith("gsk_"));
    if (!keys.length) return NextResponse.json({ error: "音声APIが設定されていません。" }, { status: 503 });

    let lastStatus = 503;
    for (const key of shuffled(keys)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "canopylabs/orpheus-v1-english", input: text, voice: "hannah", response_format: "wav" }),
          signal: controller.signal,
        });
        lastStatus = response.status;
        if (response.ok) {
          return new NextResponse(await response.arrayBuffer(), {
            headers: { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=3600" },
          });
        }
        if (![429, 500, 502, 503].includes(response.status)) break;
      } catch {
        lastStatus = 503;
      } finally {
        clearTimeout(timer);
      }
    }
    return NextResponse.json({ error: "高品質音声を利用できません。" }, { status: lastStatus === 429 ? 429 : 503 });
  } catch {
    return NextResponse.json({ error: "音声生成に失敗しました。" }, { status: 500 });
  }
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}
