import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
const groqEndpoint = "https://api.groq.com/openai/v1/audio/speech";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const text = typeof body.text === "string"
      ? body.text.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 300)
      : "";
    const speed = body.speed === "slow" ? "slow" : "normal";
    const style = body.style === "boss" ? "boss" : "teacher";
    if (!text) return NextResponse.json({ error: "読み上げる文章がありません。" }, { status: 400 });

    const geminiKeys = (process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || "")
      .split(/[\n,]+/).map((key) => key.trim()).filter(Boolean);

    const configuredModel = (process.env.GEMINI_TTS_MODEL || "").replace(/^models\//, "");
    const geminiModels = Array.from(new Set([
      configuredModel,
      "gemini-3.1-flash-tts-preview",
      "gemini-2.5-flash-preview-tts",
    ].filter(Boolean)));

    for (const key of shuffled(geminiKeys)) {
      const result = await geminiSpeech(key, text, speed, geminiModels, style);
      if (result) {
        return new NextResponse(result.audio, {
          headers: {
            "Content-Type": "audio/wav",
            "Cache-Control": "public, max-age=86400",
            "X-SpeakUp-Voice": `Gemini-Kore:${result.model}`,
          },
        });
      }
    }

    const groqKeys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
      .split(/[\n,]+/).map((key) => key.trim()).filter((key) => key.startsWith("gsk_"));

    for (const key of shuffled(groqKeys)) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(groqEndpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "canopylabs/orpheus-v1-english",
            input: text,
            voice: "hannah",
            response_format: "wav",
          }),
          signal: controller.signal,
        });
        if (response.ok) {
          return new NextResponse(await response.arrayBuffer(), {
            headers: {
              "Content-Type": "audio/wav",
              "Cache-Control": "public, max-age=3600",
              "X-SpeakUp-Voice": "Orpheus-Hannah",
            },
          });
        }
      } catch {
        // Try the next configured key.
      } finally {
        clearTimeout(timer);
      }
    }

    return NextResponse.json({ error: "高品質音声を利用できません。" }, { status: 503 });
  } catch {
    return NextResponse.json({ error: "音声生成に失敗しました。" }, { status: 500 });
  }
}

async function geminiSpeech(
  key: string,
  text: string,
  speed: "slow" | "normal",
  models: string[],
  style: "teacher" | "boss",
) {
  const voice = process.env.GEMINI_TTS_VOICE || "Kore";
  const pace = speed === "slow"
    ? "Speak clearly and a little slowly, with natural pauses. Do not sound robotic or stretched."
    : "Speak at a natural conversational pace.";
  for (const model of models) {
    const controller = new AbortController();
    // Do not make the learner wait too long for a single provider/model.
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: style === "boss"
                ? `Perform the transcript as a powerful, deep, cinematic but friendly fantasy game boss. Sound expressive and natural, never robotic, and keep the English very clear for students. ${pace}\n\nTranscript:\n${text}`
                : `Read the transcript in natural American English. Use a warm, friendly English teacher voice. ${pace}\n\nTranscript:\n${text}`,
            }],
          }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: voice },
              },
            },
          },
        }),
        signal: controller.signal,
      },
    );
      if (!response.ok) continue;
      const data = await response.json();
      const part = data?.candidates?.[0]?.content?.parts?.find(
        (item: any) => item?.inlineData?.data || item?.inline_data?.data,
      );
      const inline = part?.inlineData || part?.inline_data;
      if (!inline?.data) continue;
      const pcm = Buffer.from(inline.data, "base64");
      const mime = String(inline.mimeType || inline.mime_type || "");
      const audio = /wav/i.test(mime)
        ? pcm
        : pcmToWav(pcm, Number(mime.match(/rate=(\d+)/i)?.[1]) || 24000);
      return { audio, model };
    } catch {
      // Try the next supported Gemini TTS model.
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

function pcmToWav(pcm: Buffer, sampleRate: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}
