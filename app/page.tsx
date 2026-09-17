"use client";

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import QRCode from "qrcode";

type Message = { role: "user" | "assistant"; text: string };
type Mode = "grammar" | "free" | "custom";
type Settings = {
  level: string;
  targetLevel: string;
  cefr: "A0" | "A1" | "A2" | "B1";
  proficiencyType: "cefr" | "eiken";
  mode: Mode;
  topic: string;
  unit: string;
  showHints: boolean;
  showTranslations: boolean;
};
type Review = {
  score: number;
  feedback: string;
  breakdown?: {
    communication: { score: number; reason: string };
    grammar: { score: number; reason: string };
    vocabulary: { score: number; reason: string };
    interaction: { score: number; reason: string };
  };
  strengths: string[];
  grammarPoints: string[];
  naturalExpressions: string[];
  vocabulary: string[];
  nextGoal: string;
};
type Session = {
  id: string;
  date: string;
  settings: Settings;
  messages: Message[];
  review: Review;
};
type Question = {
  type: "grammar" | "vocabulary";
  question: string;
  options: string[];
  answer: number;
  explanation: string;
};

const STORAGE_KEY = "speakup-sessions-v1";
const initialSettings: Settings = {
  level: "中学2年生",
  targetLevel: "英検3級",
  cefr: "A1",
  proficiencyType: "cefr",
  mode: "grammar",
  topic: "",
  unit: "過去形・過去進行形",
  showHints: true,
  showTranslations: true,
};

const modes: {
  value: Mode;
  icon: string;
  title: string;
  description: string;
}[] = [
  {
    value: "grammar",
    icon: "📘",
    title: "単元の文法で会話",
    description: "習った文法を実際の会話で使う",
  },
  {
    value: "free",
    icon: "💬",
    title: "フリートーク",
    description: "好きな内容を自由に話す",
  },
  {
    value: "custom",
    icon: "🎯",
    title: "お題を決めて会話",
    description: "興味のあるテーマで話す",
  },
];

export default function Home() {
  const [tab, setTab] = useState<"lesson" | "test" | "history">("lesson");
  const [started, setStarted] = useState(false);
  const [settings, setSettings] = useState(initialSettings);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [listening, setListening] = useState(false);
  const [audioSpeed, setAudioSpeed] = useState<"slow" | "normal">("normal");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [graded, setGraded] = useState(false);
  const [lessonReview, setLessonReview] = useState<Review | null>(null);
  const [lessonMinutes, setLessonMinutes] = useState(10);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [translations, setTranslations] = useState<Record<number, string>>({});
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [failedMessage, setFailedMessage] = useState("");
  const [pronunciation, setPronunciation] = useState<{
    target: string;
    heard?: string;
    score?: number;
  } | null>(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [shareQr, setShareQr] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setSessions(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
    } catch {
      setSessions([]);
    }
    const shared = readSharedSettings();
    if (shared) {
      setSettings(shared);
      setNotice("共有されたレッスン設定を読み込みました。");
    }
  }, []);

  useEffect(() => {
    if (!started || lessonReview || !secondsLeft) return;
    const timer = window.setInterval(
      () =>
        setSecondsLeft((value) => {
          if (value <= 1) {
            window.clearInterval(timer);
            setNotice(
              "レッスン時間になりました。会話を終了して振り返りましょう！",
            );
            return 0;
          }
          return value - 1;
        }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [started, lessonReview, secondsLeft > 0]);

  const turns = messages.filter((m) => m.role === "user").length;
  const score = useMemo(
    () =>
      questions.reduce(
        (total, question, index) =>
          total + (answers[index] === question.answer ? 1 : 0),
        0,
      ),
    [answers, questions],
  );

  async function callApi(action: string, data: object, timeoutMs = 35000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...data }),
        signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "通信に失敗しました。");
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  function startLesson() {
    if (settings.mode === "custom" && !settings.topic.trim()) {
      setNotice("話したいお題を入力してください。");
      return;
    }
    const opening =
      settings.mode === "grammar"
        ? openingForUnit(settings.unit, settings.cefr)
        : settings.mode === "custom"
          ? `Hello! Let's talk about ${settings.topic}. What do you think about it?`
          : "Hello! Nice to meet you. How are you today?";
    setMessages([{ role: "assistant", text: opening }]);
    setLessonReview(null);
    setSecondsLeft(lessonMinutes * 60);
    setTranslations({});
    setSuggestions([]);
    setFailedMessage("");
    setNotice("");
    setStarted(true);
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setNotice("AI先生につないでいます…");
    try {
      const wait = classroomDelay(getClientId(), messages.length);
      if (wait > 500) {
        setNotice("みんなで使えるよう、送信の順番を調整しています…");
        await sleep(wait);
      }
      const result = await callApi("chat", {
        message: text,
        history: messages,
        settings,
        clientId: getClientId(),
      });
      setMessages([...next, { role: "assistant", text: result.text }]);
      setSuggestions(
        settings.showHints && Array.isArray(result.suggestions)
          ? result.suggestions.slice(0, 3)
          : [],
      );
      setFailedMessage("");
      setNotice(
        result.fallback
          ? "混雑のため安定モードで返答しました。会話はそのまま続けられます。"
          : "",
      );
      void speakNatural(result.text, audioSpeed);
    } catch (error) {
      setNotice(errorText(error));
      setFailedMessage(text);
    } finally {
      setBusy(false);
    }
  }

  async function retryMessage() {
    if (!failedMessage || busy) return;
    setBusy(true);
    setNotice("もう一度送信しています…");
    try {
      const history = messages.slice(0, -1);
      const result = await callApi("chat", {
        message: failedMessage,
        history,
        settings,
        clientId: getClientId(),
      });
      setMessages([...messages, { role: "assistant", text: result.text }]);
      setSuggestions(
        settings.showHints && Array.isArray(result.suggestions)
          ? result.suggestions.slice(0, 3)
          : [],
      );
      setFailedMessage("");
      setNotice(result.fallback ? "混雑のため安定モードで返答しました。" : "");
      void speakNatural(result.text, audioSpeed);
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function showTranslation(text: string, index: number) {
    if (translations[index] || busy) {
      if (translations[index])
        setTranslations({ ...translations, [index]: "" });
      return;
    }
    setBusy(true);
    try {
      const result = await callApi("translate", {
        text,
        clientId: getClientId(),
      });
      setTranslations({ ...translations, [index]: result.text });
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function startPronunciation(target: string) {
    setPronunciation({ target });
    void speakNatural(target, "slow");
  }
  function recordPronunciation() {
    if (!pronunciation) return;
    const Recognition = (
      window as Window & { webkitSpeechRecognition?: new () => any }
    ).webkitSpeechRecognition;
    if (!Recognition) {
      setNotice("発音評価はChromeまたはEdgeで利用してください。");
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setNotice("聞き取れませんでした。静かな場所でもう一度試してください。");
    };
    recognition.onresult = (event: any) => {
      const heard = event.results[0][0].transcript;
      setPronunciation({
        ...pronunciation,
        heard,
        score: pronunciationScore(pronunciation.target, heard),
      });
    };
    recognition.start();
  }

  async function makeShareQr() {
    const link = sharedSettingsUrl(settings);
    setShareQr(
      await QRCode.toDataURL(link, {
        width: 280,
        margin: 2,
        color: { dark: "#31207d", light: "#ffffff" },
      }),
    );
  }

  function exportHistory() {
    const blob = new Blob(
      [JSON.stringify({ app: "SpeakUp", version: 1, sessions }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `speakup-history-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  async function importHistory(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()),
        incoming = Array.isArray(data) ? data : data.sessions;
      if (!Array.isArray(incoming)) throw new Error();
      const valid = incoming.filter(validSession).slice(0, 30);
      if (!valid.length) throw new Error();
      setSessions(valid);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
      setNotice(`${valid.length}件の履歴を読み込みました。`);
    } catch {
      setNotice("このファイルはSpeakUp!の履歴ファイルではありません。");
    }
    event.target.value = "";
  }
  function deleteHistory() {
    if (
      !confirm(
        "保存した英会話履歴をすべて削除しますか？この操作は元に戻せません。",
      )
    )
      return;
    setSessions([]);
    localStorage.removeItem(STORAGE_KEY);
    setNotice("履歴を削除しました。");
  }

  async function finishLesson() {
    if (!turns || busy) return;
    setBusy(true);
    setNotice("会話を振り返っています…");
    try {
      const result = await callApi("review", {
        history: messages,
        settings,
        clientId: getClientId(),
      });
      const session: Session = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        settings,
        messages,
        review: result.review,
      };
      const next = [session, ...sessions].slice(0, 30);
      setSessions(next);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setLessonReview(result.review);
      setNotice("");
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function makeTest() {
    if (!sessions.length || busy) return;
    setBusy(true);
    setNotice("履歴から問題を作っています…");
    setAnswers({});
    setGraded(false);
    try {
      const compact = sessions.slice(0, 10).map((session) => ({
        level: levelName(session.settings),
        unit: session.settings.unit,
        userEnglish: session.messages
          .filter((m) => m.role === "user")
          .map((m) => m.text)
          .join(" / ")
          .slice(0, 1200),
        review: session.review,
      }));
      const result = await callApi("summaryTest", {
        sessions: compact,
        clientId: getClientId(),
      });
      setQuestions(result.questions);
      setNotice("");
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function startListening() {
    const Recognition = (
      window as Window & { webkitSpeechRecognition?: new () => any }
    ).webkitSpeechRecognition;
    if (!Recognition) {
      setNotice(
        "このブラウザでは音声入力を利用できません。文字で入力してください。",
      );
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      setNotice("うまく聞き取れませんでした。もう一度押して話してください。");
    };
    recognition.onresult = (event: any) =>
      setInput(event.results[0][0].transcript);
    recognition.start();
  }

  return (
    <main>
      <header>
        <button
          className="brand brandButton"
          onClick={() => {
            setTab("lesson");
            setStarted(false);
          }}
        >
          <img className="brandLogo" src="/speakup-icon-192.png" alt="" />
          <span>
            <b>SpeakUp!</b>
            <small>AI ENGLISH PARTNER</small>
          </span>
        </button>
        <nav>
          <button
            className={tab === "lesson" ? "on" : ""}
            onClick={() => setTab("lesson")}
          >
            レッスン
          </button>
          <button
            className={tab === "test" ? "on" : ""}
            onClick={() => setTab("test")}
          >
            まとめテスト
          </button>
          <button
            className={tab === "history" ? "on" : ""}
            onClick={() => setTab("history")}
          >
            履歴
          </button>
          <button
            onClick={() => {
              window.location.href = "/group";
            }}
          >
            みんなでクイズ
          </button>
        </nav>
      </header>

      {tab === "lesson" && !started && (
        <section className="setup">
          <div className="setupTitle">
            <em>NEW LESSON</em>
            <h1>今日はどんな英会話をする？</h1>
            <p>会話の練習方法とレベルを選んでください。</p>
          </div>

          <div className="modeGrid">
            {modes.map((mode) => (
              <button
                key={mode.value}
                className={`modeCard ${settings.mode === mode.value ? "selected" : ""}`}
                onClick={() => setSettings({ ...settings, mode: mode.value })}
              >
                <span className="modeIcon">{mode.icon}</span>
                <b>{mode.title}</b>
                <small>{mode.description}</small>
                <span className="check">✓</span>
              </button>
            ))}
          </div>

          <div className="setupCard">
            <ChoiceGroup
              title="学年"
              values={["中学1年生", "中学2年生", "中学3年生", "高校生"]}
              selected={settings.level}
              onSelect={(level) =>
                setSettings({ ...settings, level, unit: unitsFor(level)[0] })
              }
            />
            <ChoiceGroup
              title="レベルの選び方（どちらか1つ）"
              values={["cefr", "eiken"]}
              labels={["CEFR（A0〜B1）で選ぶ", "英検（5級〜2級）で選ぶ"]}
              selected={settings.proficiencyType}
              onSelect={(proficiencyType) =>
                setSettings({
                  ...settings,
                  proficiencyType:
                    proficiencyType as Settings["proficiencyType"],
                })
              }
            />
            {settings.proficiencyType === "cefr" ? (
              <ChoiceGroup
                title="CEFRレベル"
                values={["A0", "A1", "A2", "B1"]}
                labels={["A0 はじめて", "A1 初級", "A2 基礎", "B1 中級"]}
                selected={settings.cefr}
                onSelect={(cefr) =>
                  setSettings({ ...settings, cefr: cefr as Settings["cefr"] })
                }
              />
            ) : (
              <ChoiceGroup
                title="英検レベル"
                values={[
                  "英検5級",
                  "英検4級",
                  "英検3級",
                  "英検準2級",
                  "英検2級",
                ]}
                selected={settings.targetLevel}
                onSelect={(targetLevel) =>
                  setSettings({ ...settings, targetLevel })
                }
              />
            )}

            {settings.mode === "grammar" && (
              <div className="fieldBlock">
                <b>練習する単元</b>
                <div className="unitGrid">
                  {unitsFor(settings.level).map((unit) => (
                    <button
                      key={unit}
                      className={settings.unit === unit ? "selected" : ""}
                      onClick={() => setSettings({ ...settings, unit })}
                    >
                      {unit}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {settings.mode === "custom" && (
              <label className="topicField">
                <b>話したいお題</b>
                <input
                  value={settings.topic}
                  onChange={(event) =>
                    setSettings({ ...settings, topic: event.target.value })
                  }
                  placeholder="例：テニス、好きな音楽、行きたい国"
                  maxLength={60}
                />
              </label>
            )}
            <ChoiceGroup
              title="会話時間"
              values={["0", "5", "10", "15"]}
              labels={["時間制限なし", "5分", "10分", "15分"]}
              selected={String(lessonMinutes)}
              onSelect={(value) => setLessonMinutes(Number(value))}
            />

            <div className="supportSettings">
              <div className="supportHeading">
                <span>⚙️</span>
                <div>
                  <b>学習サポート設定</b>
                  <small>答えのヒントになる機能を個別に設定できます</small>
                </div>
              </div>
              <SupportToggle
                title="返答ヒント"
                description="会話中に英語の返答例を表示します"
                enabled={settings.showHints}
                onToggle={() => {
                  setSettings({ ...settings, showHints: !settings.showHints });
                  setSuggestions([]);
                }}
              />
              <SupportToggle
                title="日本語訳"
                description="AIの英文に日本語訳ボタンを表示します"
                enabled={settings.showTranslations}
                onToggle={() => {
                  setSettings({
                    ...settings,
                    showTranslations: !settings.showTranslations,
                  });
                  setTranslations({});
                }}
              />
              {!settings.showHints && !settings.showTranslations && (
                <p className="supportModeNote">
                  集中モード：ヒントと日本語訳を表示しません
                </p>
              )}
            </div>
          </div>

          <div className="setupTools">
            <button onClick={() => void makeShareQr()}>
              ▦ この設定のQRを作る
            </button>
          </div>
          {shareQr && (
            <div className="sharePanel">
              <button className="closeMini" onClick={() => setShareQr("")}>
                ×
              </button>
              <b>このQRを読み取ると同じ設定になります</b>
              <img src={shareQr} alt="レッスン設定共有QRコード" />
              <small>氏名や会話履歴は含まれません。</small>
            </div>
          )}
          <div className="privacyNote">
            <b>🔒 利用前のお願い</b>
            <span>
              氏名・住所・連絡先などの個人情報は入力しないでください。会話履歴はこのブラウザ内だけに保存されます。
            </span>
          </div>

          {notice && <div className="notice setupNotice">{notice}</div>}
          <button className="startButton" onClick={startLesson}>
            <span>会話を始める</span>
            <span>→</span>
          </button>
        </section>
      )}

      {tab === "lesson" && started && !lessonReview && (
        <section className="card chat chatOnly">
          <div className="chatHead">
            <button className="backButton" onClick={() => setStarted(false)}>
              ← 設定に戻る
            </button>
            <div>
              <em>
                {modeName(settings.mode)} · {levelName(settings)}
              </em>
              <h1>{lessonTitle(settings)}</h1>
            </div>
            <span>
              {lessonMinutes ? formatTime(secondsLeft) : `${turns} turns`}
            </span>
          </div>
          <div className="voiceSettings">
            <span>🔊 ネイティブ音声</span>
            <div>
              <button
                className={audioSpeed === "slow" ? "selected" : ""}
                onClick={() => setAudioSpeed("slow")}
              >
                ゆっくり
              </button>
              <button
                className={audioSpeed === "normal" ? "selected" : ""}
                onClick={() => setAudioSpeed("normal")}
              >
                普通
              </button>
            </div>
          </div>
          <div className="messages">
            {messages.map((message, index) => (
              <div className={`row ${message.role}`} key={index}>
                <i>{message.role === "assistant" ? "AI" : "YOU"}</i>
                <div className="bubbleWrap">
                  <p>{message.text}</p>
                  {message.role === "assistant" && (
                    <div className="messageActions">
                      <button
                        onClick={() =>
                          void speakNatural(message.text, audioSpeed)
                        }
                      >
                        🔊 聞く
                      </button>
                      {settings.showTranslations && (
                        <button
                          onClick={() =>
                            void showTranslation(message.text, index)
                          }
                        >
                          🇯🇵 訳
                        </button>
                      )}
                      <button onClick={() => startPronunciation(message.text)}>
                        🎤 発音
                      </button>
                    </div>
                  )}
                  {translations[index] && (
                    <div className="translation">{translations[index]}</div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="row assistant">
                <i>AI</i>
                <p>Thinking •••</p>
              </div>
            )}
          </div>
          {pronunciation && (
            <div className="practicePanel">
              <button
                className="closeMini"
                onClick={() => setPronunciation(null)}
              >
                ×
              </button>
              <b>発音練習</b>
              <p>{pronunciation.target}</p>
              <button className="practiceButton" onClick={recordPronunciation}>
                {listening ? "聞き取り中…" : "🎙️ この英文を言う"}
              </button>
              {pronunciation.heard && (
                <div className="pronunciationResult">
                  <strong>{pronunciation.score}点</strong>
                  <span>聞こえた英語：{pronunciation.heard}</span>
                  <small>音声認識との一致度による簡易評価です。</small>
                </div>
              )}
            </div>
          )}
          {settings.showHints && !!suggestions.length && (
            <div className="suggestions">
              <b>返答例</b>
              {suggestions.map((suggestion) => (
                <button key={suggestion} onClick={() => setInput(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          {notice && (
            <div className="notice">
              {notice}
              {failedMessage && (
                <button className="retryButton" onClick={retryMessage}>
                  もう一度送る
                </button>
              )}
            </div>
          )}
          <form onSubmit={sendMessage}>
            <button
              type="button"
              className={`mic ${listening ? "recording" : ""}`}
              onClick={startListening}
              aria-label="音声入力"
            >
              🎙️
            </button>
            <input
              maxLength={500}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="英語で話す・入力する…"
            />
            <button
              className="send"
              disabled={!input.trim() || busy}
              aria-label="送信"
            >
              ➤
            </button>
          </form>
          <button
            className="finish"
            disabled={!turns || busy}
            onClick={finishLesson}
          >
            レッスンを終了して分析・保存
          </button>
        </section>
      )}

      {tab === "lesson" && started && lessonReview && (
        <section className="card lessonReview">
          <div className="reviewHero">
            <em>AI TEACHER&apos;S FEEDBACK</em>
            <h1>AI先生からの振り返り</h1>
            <div className="reviewScore">
              <strong>{lessonReview.score}</strong>
              <span>/ 100点</span>
            </div>
            <p>{lessonReview.feedback}</p>
          </div>

          <div className="reviewGrid">
            <ReviewBlock
              icon="✨"
              title="良かったところ"
              items={lessonReview.strengths}
              empty="会話を最後まで続けられたことが素晴らしいです。"
            />
            <ReviewBlock
              icon="📝"
              title="直すともっと良くなる文法"
              items={lessonReview.grammarPoints}
              empty="大きな文法ミスはありませんでした。"
            />
            <ReviewBlock
              icon="💡"
              title="より自然な言い方"
              items={lessonReview.naturalExpressions}
              empty="今回の表現は自然に伝わっています。"
            />
            <ReviewBlock
              icon="📚"
              title="覚えておきたい単語"
              items={lessonReview.vocabulary}
              empty="新しい単語にも挑戦してみましょう。"
            />
          </div>

          {lessonReview.breakdown && (
            <div className="scoreBreakdown">
              <h2>採点の内訳</h2>
              <ScoreRow
                label="伝わりやすさ"
                value={lessonReview.breakdown.communication.score}
                max={30}
                reason={lessonReview.breakdown.communication.reason}
              />
              <ScoreRow
                label="文法"
                value={lessonReview.breakdown.grammar.score}
                max={25}
                reason={lessonReview.breakdown.grammar.reason}
              />
              <ScoreRow
                label="語彙"
                value={lessonReview.breakdown.vocabulary.score}
                max={20}
                reason={lessonReview.breakdown.vocabulary.reason}
              />
              <ScoreRow
                label="会話の継続"
                value={lessonReview.breakdown.interaction.score}
                max={25}
                reason={lessonReview.breakdown.interaction.reason}
              />
            </div>
          )}

          <div className="nextGoal">
            <span>🎯 次の目標</span>
            <b>
              {lessonReview.nextGoal ||
                "今日覚えた表現を、次の会話でもう一度使ってみよう！"}
            </b>
          </div>
          <div className="reviewActions">
            <button className="subAction" onClick={() => setTab("history")}>
              履歴を見る
            </button>
            <button
              className="primaryAction"
              onClick={() => {
                setStarted(false);
                setLessonReview(null);
                setMessages([]);
              }}
            >
              次のレッスンへ
            </button>
          </div>
        </section>
      )}

      {tab === "test" && (
        <section className="card single">
          <em>REVIEW</em>
          <h1>総まとめ文法・単語テスト</h1>
          <p className="lead">保存した会話から、自分専用の問題を作ります。</p>
          {!sessions.length && (
            <div className="empty">
              まず英会話を1回行い、「分析・保存」してください。
            </div>
          )}
          <button
            className="primary"
            disabled={!sessions.length || busy}
            onClick={makeTest}
          >
            {questions.length ? "新しい問題を作る" : "履歴から10問作る"}
          </button>
          {notice && <div className="notice">{notice}</div>}
          {questions.map((question, index) => (
            <article className="question" key={index}>
              <b>
                {index + 1}. {question.type === "grammar" ? "文法" : "単語"}
              </b>
              <h3>{question.question}</h3>
              <div className="options">
                {question.options.map((option, optionIndex) => (
                  <button
                    key={optionIndex}
                    disabled={graded}
                    className={
                      (answers[index] === optionIndex ? "selected " : "") +
                      (graded && optionIndex === question.answer
                        ? "correct "
                        : "") +
                      (graded &&
                      answers[index] === optionIndex &&
                      optionIndex !== question.answer
                        ? "wrong"
                        : "")
                    }
                    onClick={() =>
                      setAnswers({ ...answers, [index]: optionIndex })
                    }
                  >
                    {String.fromCharCode(65 + optionIndex)}. {option}
                  </button>
                ))}
              </div>
              {graded && <p className="explain">{question.explanation}</p>}
            </article>
          ))}
          {!!questions.length && !graded && (
            <button
              className="primary"
              disabled={Object.keys(answers).length !== questions.length}
              onClick={() => setGraded(true)}
            >
              採点する
            </button>
          )}
          {graded && (
            <div className="result">
              <b>
                {score} / {questions.length}
              </b>
              <span>
                {score >= 8
                  ? "すばらしい！"
                  : score >= 6
                    ? "あと少し！"
                    : "履歴を見て復習しよう！"}
              </span>
            </div>
          )}
          {graded && score < questions.length && (
            <button
              className="primary"
              onClick={() => {
                const wrong = questions.filter(
                  (question, index) => answers[index] !== question.answer,
                );
                setQuestions(wrong);
                setAnswers({});
                setGraded(false);
              }}
            >
              間違えた{questions.length - score}問に再挑戦
            </button>
          )}
        </section>
      )}

      {tab === "history" && (
        <section className="card single">
          <em>MY PROGRESS</em>
          <h1>英会話の履歴</h1>
          <div className="historyTools">
            <input
              value={historyQuery}
              onChange={(event) => setHistoryQuery(event.target.value)}
              placeholder="日付・単元・会話内容を検索"
            />
            <button onClick={exportHistory} disabled={!sessions.length}>
              書き出す
            </button>
            <button onClick={() => importRef.current?.click()}>読み込む</button>
            <button
              className="dangerButton"
              onClick={deleteHistory}
              disabled={!sessions.length}
            >
              すべて削除
            </button>
            <input
              ref={importRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={importHistory}
            />
          </div>
          {notice && <div className="notice historyNotice">{notice}</div>}
          {!sessions.length && (
            <div className="empty">保存されたレッスンはまだありません。</div>
          )}
          {sessions
            .filter((session) =>
              sessionSearchText(session).includes(historyQuery.toLowerCase()),
            )
            .map((session) => (
              <details key={session.id}>
                <summary>
                  <div>
                    <b>
                      {new Date(session.date).toLocaleDateString("ja-JP")}・
                      {lessonTitle(session.settings)}
                    </b>
                    <small>
                      {levelName(session.settings)} /{" "}
                      {session.messages.filter((m) => m.role === "user").length}{" "}
                      turns
                    </small>
                  </div>
                  <strong>{session.review.score}点</strong>
                </summary>
                <div className="review">
                  <p>{session.review.feedback}</p>
                  <b>文法ポイント</b>
                  <ul>
                    {session.review.grammarPoints.map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                  <b>復習単語</b>
                  <div className="chips">
                    {session.review.vocabulary.map((word, index) => (
                      <span key={index}>{word}</span>
                    ))}
                  </div>
                </div>
              </details>
            ))}
        </section>
      )}
      <footer>SpeakUp! — 会話して、気づいて、もう一度使おう。</footer>
    </main>
  );
}

function ChoiceGroup({
  title,
  values,
  labels,
  selected,
  onSelect,
}: {
  title: string;
  values: string[];
  labels?: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div className="fieldBlock">
      <b>{title}</b>
      <div className="choiceRow">
        {values.map((value, index) => (
          <button
            key={value}
            className={selected === value ? "selected" : ""}
            onClick={() => onSelect(value)}
          >
            {labels?.[index] || value}
          </button>
        ))}
      </div>
    </div>
  );
}
function SupportToggle({
  title,
  description,
  enabled,
  onToggle,
}: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`supportToggle ${enabled ? "enabled" : ""}`}
      onClick={onToggle}
      aria-pressed={enabled}
    >
      <span>
        <b>{title}</b>
        <small>{description}</small>
      </span>
      <i>{enabled ? "ON" : "OFF"}</i>
    </button>
  );
}
function ReviewBlock({
  icon,
  title,
  items,
  empty,
}: {
  icon: string;
  title: string;
  items?: string[];
  empty: string;
}) {
  const content = items?.filter(Boolean) || [];
  return (
    <article className="reviewBlock">
      <h2>
        <span>{icon}</span>
        {title}
      </h2>
      <ul>
        {(content.length ? content : [empty]).map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </article>
  );
}
function ScoreRow({
  label,
  value,
  max,
  reason,
}: {
  label: string;
  value: number;
  max: number;
  reason: string;
}) {
  return (
    <div className="scoreRow">
      <div>
        <b>{label}</b>
        <span>{reason}</span>
      </div>
      <div className="scoreBar">
        <i
          style={{
            width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`,
          }}
        />
      </div>
      <strong>
        {value}
        <small>/{max}</small>
      </strong>
    </div>
  );
}
function getClientId() {
  let id = localStorage.getItem("speakup-client-id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("speakup-client-id", id);
  }
  return id;
}
function classroomDelay(clientId: string, turn: number) {
  let hash = 2166136261;
  const value = `${clientId}-${turn}`;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0) % 4500;
}
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
let activeAudio: HTMLAudioElement | null = null;
async function speakNatural(text: string, speed: "slow" | "normal") {
  try {
    activeAudio?.pause();
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error("TTS unavailable");
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url);
    activeAudio = audio;
    audio.playbackRate = speed === "slow" ? 0.82 : 1;
    audio.onended = () => {
      URL.revokeObjectURL(url);
      if (activeAudio === audio) activeAudio = null;
    };
    audio.onerror = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch {
    fallbackSpeak(text, speed);
  }
}
function fallbackSpeak(text: string, speed: "slow" | "normal") {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = speed === "slow" ? 0.72 : 0.9;
  speechSynthesis.speak(utterance);
}
function errorText(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
    ? "応答に時間がかかっています。少し待ってからもう一度お試しください。"
    : error instanceof Error
      ? error.message
      : "エラーが発生しました。";
}
function modeName(mode: Mode) {
  return mode === "grammar"
    ? "単元文法"
    : mode === "custom"
      ? "お題トーク"
      : "フリートーク";
}
function lessonTitle(settings: Settings) {
  return settings.mode === "grammar"
    ? settings.unit
    : settings.mode === "custom"
      ? settings.topic || "お題トーク"
      : "Free Conversation";
}
function levelName(settings: Settings) {
  return settings.proficiencyType === "eiken"
    ? settings.targetLevel
    : `CEFR ${settings.cefr || "A1"}`;
}
function openingForUnit(unit: string, cefr: string) {
  const examples: Record<string, string> = {
    be動詞: "Hello! I am your English partner. How are you today?",
    一般動詞: "Hello! I like music and sports. What do you like?",
    "疑問文・否定文": "Hello! Let's ask questions today. Do you like sports?",
    can: "Hello! I can speak English. What can you do?",
    現在進行形: "Hello! I am talking with you now. What are you doing?",
    過去形: "Hello! I watched a movie yesterday. What did you do?",
    "過去形・過去進行形":
      "Hello! I was reading last night. What were you doing?",
    未来表現: "Hello! I am going to study tonight. What are you going to do?",
    助動詞: "Hello! We should practice English. What should we talk about?",
    不定詞: "Hello! I want to learn about you. What do you want to do?",
    動名詞: "Hello! I enjoy learning languages. What do you enjoy doing?",
    "比較級・最上級":
      "Hello! Summer is hotter than spring. Which season do you like best?",
    接続詞: "Hello! I am happy because we can talk. What makes you happy?",
    受け身: "Hello! English is spoken around the world. Where is English used?",
    現在完了: "Hello! I have visited many places. Have you ever traveled far?",
    現在完了進行形:
      "Hello! I have been waiting to talk with you. What have you been doing?",
    分詞: "Hello! I saw an exciting game. What was exciting for you?",
    関係代名詞:
      "Hello! A friend who helps you is special. Who is important to you?",
    間接疑問文: "Hello! I wonder what you like. Can you tell me?",
    仮定法:
      "Hello! If I could travel anywhere, I would visit Japan. Where would you go?",
  };
  return (
    examples[unit] ||
    (cefr === "A0"
      ? "Hello! I am happy. Are you happy?"
      : `Hello! Let's practice ${unit}. Are you ready?`)
  );
}
function unitsFor(level: string) {
  if (level === "中学1年生")
    return [
      "be動詞",
      "一般動詞",
      "疑問文・否定文",
      "can",
      "現在進行形",
      "過去形",
    ];
  if (level === "中学2年生")
    return [
      "過去形・過去進行形",
      "未来表現",
      "助動詞",
      "不定詞",
      "動名詞",
      "比較級・最上級",
      "接続詞",
      "受け身",
    ];
  if (level === "中学3年生")
    return [
      "現在完了",
      "現在完了進行形",
      "不定詞の応用",
      "分詞",
      "関係代名詞",
      "間接疑問文",
      "仮定法",
    ];
  return [
    "時制",
    "助動詞",
    "受動態",
    "不定詞・動名詞",
    "分詞構文",
    "関係詞",
    "比較",
    "仮定法",
  ];
}
function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60),
    rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
function pronunciationScore(target: string, heard: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z' ]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const a = normalize(target),
    b = normalize(heard),
    rows = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let j = 1; j <= b.length; j++) {
    let previous = rows[0];
    rows[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const saved = rows[i];
      rows[i] = Math.min(
        rows[i] + 1,
        rows[i - 1] + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = saved;
    }
  }
  return Math.max(
    0,
    Math.round((1 - rows[a.length] / Math.max(a.length, b.length, 1)) * 100),
  );
}
function sharedSettingsUrl(settings: Settings) {
  const url = new URL(window.location.origin + window.location.pathname);
  const params = new URLSearchParams({
    shared: "1",
    grade: settings.level,
    type: settings.proficiencyType,
    cefr: settings.cefr,
    eiken: settings.targetLevel,
    mode: settings.mode,
    unit: settings.unit,
    topic: settings.topic,
    hints: settings.showHints ? "1" : "0",
    translation: settings.showTranslations ? "1" : "0",
  });
  url.search = params.toString();
  return url.toString();
}
function readSharedSettings(): Settings | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("shared") !== "1") return null;
  const level = params.get("grade") || initialSettings.level,
    mode = (
      ["grammar", "free", "custom"].includes(params.get("mode") || "")
        ? params.get("mode")
        : "grammar"
    ) as Mode,
    cefr = (
      ["A0", "A1", "A2", "B1"].includes(params.get("cefr") || "")
        ? params.get("cefr")
        : "A1"
    ) as Settings["cefr"];
  return {
    level,
    targetLevel: params.get("eiken") || initialSettings.targetLevel,
    cefr,
    proficiencyType: params.get("type") === "eiken" ? "eiken" : "cefr",
    mode,
    unit: params.get("unit") || unitsFor(level)[0],
    topic: params.get("topic") || "",
    showHints: params.get("hints") !== "0",
    showTranslations: params.get("translation") !== "0",
  };
}
function validSession(value: any): value is Session {
  return (
    value &&
    typeof value.id === "string" &&
    typeof value.date === "string" &&
    value.settings &&
    Array.isArray(value.messages) &&
    value.review &&
    typeof value.review.score === "number"
  );
}
function sessionSearchText(session: Session) {
  return `${new Date(session.date).toLocaleDateString("ja-JP")} ${lessonTitle(session.settings)} ${levelName(session.settings)} ${session.messages.map((message) => message.text).join(" ")}`.toLowerCase();
}
