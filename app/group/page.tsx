"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import "./group.css";
type Question = {
  type?: "grammar" | "speaking";
  question: string;
  options: string[];
  answer?: number;
  explanation?: string;
};
type Player = { id: string; name: string; score: number; streak: number };
type GameMode = "normal" | "boss" | "risk";
type State = {
  room: {
    id: string;
    code: string;
    title: string;
    status: "lobby" | "question" | "reveal" | "finished";
    currentQuestion: number;
    totalQuestions: number;
    gameMode: GameMode;
    question: Question | null;
  };
  players: Player[];
  answeredPlayerIds: string[];
  answerCount: number;
  questions?: Question[];
  boss?: { hp: number; maxHp: number; damage: number };
};
const grades = ["中学1年生", "中学2年生", "中学3年生", "高校生"];
const units: Record<string, string[]> = {
  中学1年生: [
    "be動詞",
    "一般動詞",
    "疑問文・否定文",
    "can",
    "現在進行形",
    "過去形",
  ],
  中学2年生: [
    "過去形・過去進行形",
    "未来表現",
    "助動詞",
    "不定詞",
    "動名詞",
    "比較級・最上級",
    "接続詞",
    "受け身",
  ],
  中学3年生: [
    "現在完了",
    "不定詞の応用",
    "分詞",
    "関係代名詞",
    "間接疑問文",
    "仮定法",
  ],
  高校生: [
    "時制",
    "助動詞",
    "受動態",
    "不定詞・動名詞",
    "関係詞",
    "比較",
    "仮定法",
  ],
};
const colors = ["red", "blue", "yellow", "green"];

export default function GroupQuiz() {
  const [role, setRole] = useState<"" | "host" | "player">("");
  const [gameMode, setGameMode] = useState<GameMode>("normal");
  const [grade, setGrade] = useState("中学2年生"),
    [unit, setUnit] = useState("過去形・過去進行形"),
    [level, setLevel] = useState("A1");
  const [makeMode, setMakeMode] = useState<"auto" | "myQuestions" | "manual">(
      "auto",
    ),
    [questionNotes, setQuestionNotes] = useState("");
  const [speakingCount, setSpeakingCount] = useState(2),
    [listening, setListening] = useState(false),
    [transcript, setTranscript] = useState("");
  const [manualQuestions, setManualQuestions] = useState<Question[]>([
    emptyQuestion(),
  ]);
  const [questions, setQuestions] = useState<Question[]>([]),
    [loading, setLoading] = useState(false),
    [notice, setNotice] = useState("");
  const [roomId, setRoomId] = useState(""),
    [hostToken, setHostToken] = useState(""),
    [playerId, setPlayerId] = useState(""),
    [state, setState] = useState<State | null>(null);
  const [code, setCode] = useState(""),
    [name, setName] = useState(""),
    [selected, setSelected] = useState<number | null>(null),
    [wager, setWager] = useState<1 | 2 | 3>(1);
  const [lastResult, setLastResult] = useState<{
    correct: boolean;
    points: number;
    speedPoints: number;
    streakBonus: number;
    streak: number;
    boost: boolean;
    modeBonus: number;
  } | null>(null);
  const [bossHit, setBossHit] = useState(false);
  const [bossLanguage, setBossLanguage] = useState<"ja" | "en">("ja");
  const [joinQr, setJoinQr] = useState("");
  const stageRef = useRef<HTMLElement | null>(null);
  const previousBossHp = useRef<number | null>(null);
  const spokenBossPhase = useRef("");
  useEffect(() => {
    const joinCode = new URLSearchParams(window.location.search).get("join")?.replace(/\D/g, "").slice(0, 6);
    if (joinCode?.length === 6) {
      setCode(joinCode);
      setRole("player");
    }
  }, []);
  useEffect(() => {
    if (!state?.room.code || state.room.status !== "lobby") {
      setJoinQr("");
      return;
    }
    const joinUrl = `${window.location.origin}/group?join=${state.room.code}`;
    QRCode.toDataURL(joinUrl, {
      width: 360,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#182033", light: "#ffffff" },
    }).then(setJoinQr).catch(() => setJoinQr(""));
  }, [state?.room.code, state?.room.status]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let frame = 0;
    const follow = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        stage.style.setProperty("--pointer-x", `${event.clientX}px`);
        stage.style.setProperty("--pointer-y", `${event.clientY}px`);
        stage.style.setProperty("--boss-look-x", `${(event.clientX / innerWidth - .5) * 18}px`);
        stage.style.setProperty("--boss-look-y", `${(event.clientY / innerHeight - .5) * 12}px`);
      });
    };
    window.addEventListener("pointermove", follow, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pointermove", follow); };
  }, [role, roomId]);
  useEffect(() => {
    if (!roomId) return;
    const load = () => void getState();
    load();
    const timer = setInterval(load, 1500);
    return () => clearInterval(timer);
  }, [roomId, hostToken]);
  useEffect(() => {
    setSelected(null);
    setTranscript("");
    setListening(false);
    setLastResult(null);
    setWager(1);
  }, [state?.room.currentQuestion]);
  useEffect(() => {
    if (!state?.boss || state.room.gameMode !== "boss") return;
    const oldHp = previousBossHp.current;
    if (oldHp !== null && state.boss.hp < oldHp) {
      setBossHit(true);
      const timer = setTimeout(() => setBossHit(false), 650);
      previousBossHp.current = state.boss.hp;
      return () => clearTimeout(timer);
    }
    previousBossHp.current = state.boss.hp;
  }, [state?.boss?.hp, state?.room.gameMode]);
  useEffect(() => {
    if (!state?.boss || state.room.gameMode !== "boss" || !hostToken) return;
    const phase = bossPhase(state.boss);
    if (phase === spokenBossPhase.current) return;
    spokenBossPhase.current = phase;
    void playBossVoice(bossVoiceLine(phase, bossLanguage), bossLanguage);
  }, [state?.boss?.hp, state?.room.gameMode, hostToken, bossLanguage]);

  async function api(path: string, data: any) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        const r = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "通信に失敗しました。");
        return j;
      } catch (error) {
        lastError = error;
        if (error instanceof Error && !/fetch|network|abort|通信/i.test(error.message)) throw error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
    throw new Error(
      lastError instanceof DOMException && lastError.name === "AbortError"
        ? "通信に時間がかかっています。ネット接続を確認してください。"
        : "インターネットに接続できません。接続を確認して、もう一度お試しください。",
    );
  }
  async function getState() {
    try {
      setState(await api("/api/group", { action: "state", roomId, hostToken }));
    } catch (e) {
      setNotice(message(e));
    }
  }
  async function generate() {
    if (makeMode === "myQuestions" && !questionNotes.trim()) {
      setNotice("作りたい問題やメモを入力してください。");
      return;
    }
    setLoading(true);
    setNotice(
      makeMode === "myQuestions"
        ? "AIが先生の問題をクイズに整えています…"
        : "AIが問題を作っています…",
    );
    try {
      const j = await api("/api/ai", {
        action: "groupQuiz",
        settings: {
          level: grade,
          targetLevel: "英検3級",
          cefr: level,
          proficiencyType: "cefr",
          mode: "grammar",
          topic: "",
          unit,
          showHints: false,
          showTranslations: false,
        },
        count: 10,
        speakingCount,
        sourceText: makeMode === "myQuestions" ? questionNotes : "",
        clientId: clientId(),
      });
      setQuestions(j.questions);
      setNotice("");
    } catch (e) {
      if (/インターネット|ネット接続|Failed to fetch/i.test(message(e))) {
        setQuestions(offlineQuiz(unit));
        setNotice("通信が不安定なため、単元に合った予備問題10問へ切り替えました。接続が戻ればAI生成も利用できます。");
      } else setNotice(message(e));
    } finally {
      setLoading(false);
    }
  }
  async function create() {
    if (questions.length < 3) return;
    setLoading(true);
    try {
      const j = await api("/api/group", {
        action: "create",
        title: `${unit}クイズ`,
        gameMode,
        questions,
      });
      setRoomId(j.roomId);
      setHostToken(j.hostToken);
      setNotice("");
    } catch (e) {
      setNotice(message(e));
    } finally {
      setLoading(false);
    }
  }
  function updateManual(index: number, patch: Partial<Question>) {
    setManualQuestions((list) =>
      list.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    );
  }
  function updateOption(
    questionIndex: number,
    optionIndex: number,
    value: string,
  ) {
    setManualQuestions((list) =>
      list.map((q, i) =>
        i === questionIndex
          ? {
              ...q,
              options: q.options.map((o, j) => (j === optionIndex ? value : o)),
            }
          : q,
      ),
    );
  }
  function useManualQuestions() {
    const ready = manualQuestions.filter(
      (q) =>
        q.question.trim() &&
        (q.type === "speaking"
          ? q.options[0].trim()
          : q.options.every((o) => o.trim())) &&
        Number.isInteger(q.answer),
    );
    const manualSpeakingCount = manualQuestions.filter(
      (q) => q.type === "speaking",
    ).length;
    if (manualSpeakingCount > 3) {
      setNotice("発音問題は1回のクイズにつき3問までです。");
      return;
    }
    if (ready.length < 3) {
      setNotice(
        "未入力の項目があります。完成した問題を3問以上入力してください。",
      );
      return;
    }
    setQuestions(
      ready.map((q) => ({
        ...q,
        question: q.question.trim(),
        type: q.type === "speaking" ? "speaking" : "grammar",
        options:
          q.type === "speaking"
            ? [q.options[0].trim(), "", "", ""]
            : q.options.map((o) => o.trim()),
        answer: q.type === "speaking" ? 0 : q.answer,
        explanation: q.explanation?.trim() || "先生が作った問題です。",
      })),
    );
    setNotice("");
  }
  async function join(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const j = await api("/api/group", { action: "join", code, name });
      setRoomId(j.roomId);
      setPlayerId(j.playerId);
      setNotice("");
    } catch (e) {
      setNotice(message(e));
    } finally {
      setLoading(false);
    }
  }
  async function command(command: string) {
    setLoading(true);
    try {
      await api("/api/group", { action: "host", roomId, hostToken, command });
      await getState();
    } catch (e) {
      setNotice(message(e));
    } finally {
      setLoading(false);
    }
  }
  async function answer(index: number) {
    if (selected !== null || !state) return;
    setSelected(index);
    try {
      const result = await api("/api/group", {
        action: "submit",
        roomId,
        playerId,
        questionIndex: state.room.currentQuestion,
        optionIndex: index,
        wager,
      });
      setLastResult({
        correct: Boolean(result.correct),
        points: Number(result.points) || 0,
        speedPoints: Number(result.speedPoints) || 0,
        streakBonus: Number(result.streakBonus) || 0,
        streak: Number(result.streak) || 0,
        boost: Boolean(result.boost),
        modeBonus: Number(result.modeBonus) || 0,
      });
      if (state.room.gameMode === "boss") {
        void playBossVoice(
          bossReactionLine(result.correct ? "hit" : "miss", bossLanguage),
          bossLanguage,
        );
      }
    } catch (e) {
      setNotice(message(e));
    }
  }
  function speakAnswer() {
    if (selected !== null || !q) return;
    const Recognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!Recognition) {
      setNotice(
        "このブラウザは音声認識に対応していません。ChromeまたはSafariの最新版でお試しください。",
      );
      return;
    }
    const recognition = new Recognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;
    setListening(true);
    setTranscript("");
    recognition.onresult = (event: any) => {
      const heard =
        Array.from(event.results?.[0] || [])
          .map((x: any) => String(x.transcript || ""))
          .find(Boolean) || "";
      setTranscript(heard);
      setListening(false);
      void answer(speechMatches(heard, q.options[0]) ? 0 : 1);
    };
    recognition.onerror = () => {
      setListening(false);
      setNotice(
        "音声を聞き取れませんでした。マイクを許可して、もう一度お試しください。",
      );
    };
    recognition.onend = () => setListening(false);
    recognition.start();
  }
  function reset() {
    setRole("");
    setRoomId("");
    setHostToken("");
    setPlayerId("");
    setState(null);
    setQuestions([]);
    setSelected(null);
    setNotice("");
  }

  if (!role)
    return (
      <main className="groupApp" ref={stageRef}>
        <div className="cursorWorld" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div>
        <header className="groupTop">
          <a href="/">← SpeakUp!</a>
          <b>Color Stage</b>
        </header>
        <section className="groupHero">
          <div className="heroBoss" aria-hidden="true">
            <div className="heroBossAura" />
            <img src="/boss/boss-strong.webp" alt="" />
            <span>NEW MODE</span>
            <b>CLASS BOSS BATTLE</b>
          </div>
          <div className="wordOrbit" aria-hidden="true">
            <i>GO!</i>
            <i>ABC</i>
            <i>?</i>
            <i>WOW</i>
          </div>
          <span>SPEAKUP! COLOR STAGE</span>
          <h1>
            ことばが弾ける、
            <br />
            <em>みんなの英語ステージ。</em>
          </h1>
          <p>先生の問題に、参加コードで最大40人まで参加できます。</p>
          <div className="roleCards">
            <button className="hostRole" onClick={() => setRole("host")}>
              <i>✦</i>
              <b>ステージをつくる</b>
              <small>AIや自分の問題でゲームを進行</small>
              <strong>先生はこちら →</strong>
            </button>
            <button className="playerRole" onClick={() => setRole("player")}>
              <i>↗</i>
              <b>ステージに入る</b>
              <small>6桁コードとニックネームで参加</small>
              <strong>生徒はこちら →</strong>
            </button>
          </div>
        </section>
      </main>
    );

  if (role === "host" && !roomId)
    return (
      <main className="groupApp">
        <header className="groupTop">
          <button onClick={reset}>← 戻る</button>
          <b>ステージ作成室</b>
        </header>
        <section className="hostSetup">
          <div className="setupTitle">
            <span>QUIZ STUDIO</span>
            <h1>文法クイズをつくる</h1>
            <p>AI作成、AI読み込み、1問ずつの手入力から選べます。</p>
          </div>
          <div className="makeSwitch three">
            <button
              className={makeMode === "auto" ? "on" : ""}
              onClick={() => setMakeMode("auto")}
            >
              <i>✦</i>
              <b>AIにおまかせ</b>
              <small>単元から10問を新しく作成</small>
            </button>
            <button
              className={makeMode === "myQuestions" ? "on" : ""}
              onClick={() => setMakeMode("myQuestions")}
            >
              <i>⌁</i>
              <b>まとめてAI読込</b>
              <small>メモや問題文をAIが4択化</small>
            </button>
            <button
              className={makeMode === "manual" ? "on" : ""}
              onClick={() => setMakeMode("manual")}
            >
              <i>✎</i>
              <b>1問ずつ手入力</b>
              <small>問題と答えをそのまま登録</small>
            </button>
          </div>
          {makeMode === "myQuestions" && (
            <label className="sourceBox">
              <span>先生の問題・メモ</span>
              <textarea
                maxLength={7000}
                value={questionNotes}
                onChange={(e) => setQuestionNotes(e.target.value)}
                placeholder={
                  "例：\n・I played tennis yesterday. を疑問文にする問題\n・go の過去形を答える問題\n・比較級 taller than の使い方\n\n答えや解説があれば一緒に貼り付けてください。"
                }
              />
              <small>
                {questionNotes.length}
                /7000文字　文章、箇条書き、既存の問題をそのまま貼れます。
              </small>
            </label>
          )}
          {makeMode === "manual" && (
            <div className="manualBuilder">
              <div className="manualHead">
                <div>
                  <b>問題を1問ずつ入力</b>
                  <small>最低3問・最大15問</small>
                </div>
                <span>{manualQuestions.length}問</span>
              </div>
              {manualQuestions.map((q, i) => (
                <article className="manualQuestion" key={i}>
                  <header>
                    <strong>QUESTION {String(i + 1).padStart(2, "0")}</strong>
                    {manualQuestions.length > 1 && (
                      <button
                        onClick={() =>
                          setManualQuestions((list) =>
                            list.filter((_, j) => j !== i),
                          )
                        }
                      >
                        削除
                      </button>
                    )}
                  </header>
                  <div className="manualTypeSwitch">
                    <button
                      type="button"
                      className={q.type !== "speaking" ? "on" : ""}
                      onClick={() => updateManual(i, { type: "grammar" })}
                    >
                      4択問題
                    </button>
                    <button
                      type="button"
                      className={q.type === "speaking" ? "on" : ""}
                      disabled={
                        q.type !== "speaking" &&
                        manualQuestions.filter(
                          (item) => item.type === "speaking",
                        ).length >= 3
                      }
                      onClick={() =>
                        updateManual(i, { type: "speaking", answer: 0 })
                      }
                    >
                      🎤 発音問題
                    </button>
                  </div>
                  <label>
                    {q.type === "speaking" ? "指示文" : "問題文"}
                    <input
                      maxLength={500}
                      value={q.question}
                      onChange={(e) =>
                        updateManual(i, { question: e.target.value })
                      }
                      placeholder={
                        q.type === "speaking"
                          ? "例：昨日したことを英語で言おう"
                          : "例：I (  ) tennis yesterday."
                      }
                    />
                  </label>
                  {q.type === "speaking" ? (
                    <label className="speakingPhraseInput">
                      正解として認識する英文
                      <input
                        maxLength={180}
                        value={q.options[0]}
                        onChange={(e) => updateOption(i, 0, e.target.value)}
                        placeholder="例：I played tennis yesterday."
                      />
                      <small>
                        生徒はこの英文をマイクに向かって発音します。
                      </small>
                    </label>
                  ) : (
                    <div className="manualOptions">
                      {q.options.map((o, j) => (
                        <label
                          className={q.answer === j ? "isAnswer" : ""}
                          key={j}
                        >
                          <button
                            type="button"
                            onClick={() => updateManual(i, { answer: j })}
                            aria-label={`${String.fromCharCode(65 + j)}を正解にする`}
                          >
                            {q.answer === j ? "✓" : String.fromCharCode(65 + j)}
                          </button>
                          <input
                            maxLength={180}
                            value={o}
                            onChange={(e) => updateOption(i, j, e.target.value)}
                            placeholder={`選択肢 ${String.fromCharCode(65 + j)}`}
                          />
                        </label>
                      ))}
                    </div>
                  )}
                  <label>
                    解説（任意）
                    <textarea
                      maxLength={600}
                      value={q.explanation || ""}
                      onChange={(e) =>
                        updateManual(i, { explanation: e.target.value })
                      }
                      placeholder="正解の理由を短く入力"
                    />
                  </label>
                </article>
              ))}
              <button
                className="addQuestion"
                disabled={manualQuestions.length >= 15}
                onClick={() =>
                  setManualQuestions((list) => [...list, emptyQuestion()])
                }
              >
                ＋ 問題を追加する
              </button>
            </div>
          )}
          <div className="settingPanel">
            <label>
              ゲームモード
              <div className="funModeCards">
                <button className={gameMode === "normal" ? "on" : ""} onClick={() => setGameMode("normal")}>
                  <b>🎯 スタンダード</b><small>正解と回答速度で勝負</small>
                </button>
                <button className={gameMode === "boss" ? "on boss" : ""} onClick={() => setGameMode("boss")}>
                  <b>👾 ボスバトル</b><small>クラス全員の正解でボスを倒す協力戦</small>
                </button>
                <button className={gameMode === "risk" ? "on risk" : ""} onClick={() => setGameMode("risk")}>
                  <b>🎲 リスクチャレンジ</b><small>問題ごとに1倍・2倍・3倍を賭ける</small>
                </button>
              </div>
            </label>
            <label>
              学年
              <div className="pills">
                {grades.map((g) => (
                  <button
                    className={grade === g ? "on" : ""}
                    onClick={() => {
                      setGrade(g);
                      setUnit(units[g][0]);
                    }}
                    key={g}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </label>
            <label>
              英語レベル
              <div className="pills">
                {["A0", "A1", "A2", "B1"].map((v) => (
                  <button
                    className={level === v ? "on" : ""}
                    onClick={() => setLevel(v)}
                    key={v}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </label>
            <label>
              出題単元
              <div className="pills">
                {units[grade].map((v) => (
                  <button
                    className={unit === v ? "on" : ""}
                    onClick={() => setUnit(v)}
                    key={v}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </label>
            {makeMode !== "manual" && (
              <label>
                発音問題（最大3問）
                <div className="pills speakingCount">
                  {[0, 1, 2, 3].map((v) => (
                    <button
                      className={speakingCount === v ? "on" : ""}
                      onClick={() => setSpeakingCount(v)}
                      key={v}
                    >
                      {v === 0 ? "なし" : `${v}問`}
                    </button>
                  ))}
                </div>
              </label>
            )}
          </div>
          <button
            className="bigAction"
            onClick={makeMode === "manual" ? useManualQuestions : generate}
            disabled={loading}
          >
            {loading
              ? "AIが準備中…"
              : makeMode === "myQuestions"
                ? "⌁ AIに10問へ整えてもらう"
                : makeMode === "manual"
                  ? "入力した問題を確認する →"
                  : "✦ AIで10問つくる"}
          </button>
          {notice && <p className="groupNotice">{notice}</p>}
          {questions.length > 0 && (
            <div className="preview">
              <div>
                <h2>問題を確認</h2>
                <span>{questions.length}問</span>
              </div>
              {questions.map((q, i) => (
                <details key={i}>
                  <summary>
                    <i>{String(i + 1).padStart(2, "0")}</i>
                    {q.type === "speaking" && (
                      <b className="speakBadge">発音</b>
                    )}
                    {q.question}
                  </summary>
                  <ol className={q.type === "speaking" ? "speakPreview" : ""}>
                    {q.options.map(
                      (o, j) =>
                        o && (
                          <li
                            className={j === q.answer ? "correct" : ""}
                            key={j}
                          >
                            <b>{String.fromCharCode(65 + j)}</b>
                            {o}
                          </li>
                        ),
                    )}
                  </ol>
                  <small>{q.explanation}</small>
                </details>
              ))}
              <button className="bigAction" onClick={create} disabled={loading}>
                この{questions.length}問でステージを開く →
              </button>
            </div>
          )}
        </section>
      </main>
    );

  if (role === "player" && !roomId)
    return (
      <main className="groupApp joinScreen">
        <header className="groupTop">
          <button onClick={reset}>← 戻る</button>
          <b>Color Stage</b>
        </header>
        <form onSubmit={join} className="joinCard">
          <i>↗</i>
          <span>JOIN THE STAGE</span>
          <h1>ステージに入ろう</h1>
          <label>
            参加コード
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
            />
          </label>
          <label>
            ニックネーム
            <input
              maxLength={16}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：はる"
            />
          </label>
          <button disabled={code.length !== 6 || !name.trim() || loading}>
            {loading ? "参加中…" : "ステージに入る →"}
          </button>
          {notice && <p className="groupNotice">{notice}</p>}
        </form>
      </main>
    );

  if (!state)
    return <main className="groupApp loadingScreen">読み込み中…</main>;
  const isHost = role === "host",
    q = state.room.question,
    answered = state.answeredPlayerIds.includes(playerId);
  return (
    <main ref={stageRef} className={`groupApp gameScreen ${state.room.gameMode === "boss" ? "bossTheme" : ""}`}>
      <div className="cursorWorld" aria-hidden="true"><i/><i/><i/><i/><i/><i/></div>
      <header className="gameHeader">
        <b>{state.room.title}</b>
        <span>
          参加コード <strong>{state.room.code}</strong>
        </span>
        <span>{state.players.length}/40人</span>
      </header>
      {state.room.status === "lobby" && (
        <section className="lobby">
          <div className="lobbyHeading">
            <span><i/> LIVE LOBBY</span>
            <h1>
              {isHost ? "参加者を待っています" : "まもなくスタート！"}
              <b aria-hidden="true"><i/><i/><i/></b>
            </h1>
            <p>{isHost ? "QRコードを見せて、みんなをステージに招待しよう" : "先生がクイズを開始するまで、このまま待ってね"}</p>
          </div>
          <div className="codeBox">
            <div className="joinDetails">
              <small>参加コード</small>
              <strong>{state.room.code}</strong>
              <span>QRコードを読み取ると参加コードが自動入力されます</span>
            </div>
            <div className="joinQr">
              {joinQr ? <img src={joinQr} alt={`参加コード ${state.room.code} のQRコード`} /> : <div className="qrLoading">QR<br/>準備中</div>}
              <b>スマホで参加</b>
            </div>
          </div>
          <div className="playerCloud">
            {state.players.map((p) => (
              <span key={p.id}>{p.name}</span>
            ))}
          </div>
          {isHost && (
            <div className="lobbyStart">
              <button
                className="bigAction"
                disabled={!state.players.length || loading}
                onClick={() => command("start")}
              >
                クイズを開始する
              </button>
              {!state.players.length && <small>参加者が1人入ると開始できます</small>}
            </div>
          )}
        </section>
      )}
      {(state.room.status === "question" || state.room.status === "reveal") &&
        q && (
          <section className="liveQuestion">
            <div className="questionTop">
              <span>
                ROUND {state.room.currentQuestion + 1}
                <small> / {state.room.totalQuestions}</small>
              </span>
              <b>
                {state.answerCount}/{state.players.length}人 回答
              </b>
            </div>
            {state.room.gameMode === "boss" && state.boss && (
              <div className={`bossArena phase-${bossPhase(state.boss)} ${bossHit ? "takingHit" : ""} ${state.boss.hp === 0 ? "defeated" : ""}`}>
                <div className="bossAtmosphere"><i/><i/><i/><i/><i/></div>
                <div className="bossIdentity"><span>CLASS RAID BATTLE</span><b>WORD TITAN <em>“LEX”</em></b><small>{bossMoodLine(bossPhase(state.boss))}</small></div>
                <div className="bossStage"><div className="bossSpeech">{bossCaption(bossPhase(state.boss), bossLanguage)}</div><img src={bossImage(state.boss)} alt="英語ボス LEX" />{bossHit && <div className="damageFlash">−1</div>}</div>
                <div className="bossHud">
                  <div><b>BOSS HP</b><strong>{state.boss.hp}<small> / {state.boss.maxHp}</small></strong></div>
                  <div className="bossHp"><i style={{width:`${Math.max(0,state.boss.hp/state.boss.maxHp*100)}%`}} /></div>
                  <footer><span>👥 {state.players.length}人参加</span><span>⚔️ 累計{state.boss.damage}ダメージ</span><span>正解1つ＝1ダメージ</span><div className="bossLanguage" aria-label="ボスの言語"><button className={bossLanguage === "ja" ? "on" : ""} onClick={() => setBossLanguage("ja")}>日本語</button><button className={bossLanguage === "en" ? "on" : ""} onClick={() => setBossLanguage("en")}>English</button></div></footer>
                </div>
                {state.boss.hp === 0 && <div className="defeatBurst"><i/><i/><i/><i/><i/><i/><strong>BOSS DEFEATED!</strong><span>クラス全員でLEXを倒した！</span></div>}
              </div>
            )}
            {state.room.gameMode === "risk" && !isHost && state.room.status === "question" && selected === null && (
              <div className="riskPicker">
                <b>🎲 この問題に何倍賭ける？</b>
                <div>{([1,2,3] as const).map(value => <button className={wager===value?"on":""} onClick={()=>setWager(value)} key={value}>×{value}<small>{value===1?"安全":value===2?"ミドル":"勝負！"}</small></button>)}</div>
                <p>×2・×3は高得点。ただし不正解だと減点！</p>
              </div>
            )}
            {(state.room.currentQuestion + 1) % 3 === 0 && (
              <div className="boostBanner">✦ BOOST ROUND　得点1.5倍！</div>
            )}
            <h1>{q.question}</h1>
            {isHost ? (
              <div className="hostAnswers">
                {q.type === "speaking" ? (
                  <div className="speakingCard hostSpeaking">
                    <span>🎙️ 発音チャレンジ</span>
                    <strong>{q.options[0]}</strong>
                    <small>生徒はマイクでこの英文に答えます</small>
                  </div>
                ) : (
                  <div className="answerGrid">
                    {q.options.map((o, i) => (
                      <div
                        className={`answer ${colors[i]} ${state.room.status === "reveal" && q.answer === i ? "winner" : ""}`}
                        key={i}
                      >
                        <i>{String.fromCharCode(65 + i)}</i>
                        <b>{o}</b>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className="bigAction"
                  disabled={loading}
                  onClick={() =>
                    command(
                      state.room.status === "question" ? "reveal" : "next",
                    )
                  }
                >
                  {state.room.status === "question"
                    ? "答えをオープン！"
                    : "次のラウンドへ →"}
                </button>
              </div>
            ) : q.type === "speaking" ? (
              <div className="speakingCard playerSpeaking">
                <span>🎙️ SPEAKING CHALLENGE</span>
                <strong>{q.options[0]}</strong>
                <small>
                  {listening
                    ? "聞いています…"
                    : "マイクを押して、英文を声に出そう"}
                </small>
                <button
                  className={`micButton ${listening ? "listening" : ""}`}
                  disabled={
                    selected !== null ||
                    state.room.status === "reveal" ||
                    listening
                  }
                  onClick={speakAnswer}
                  aria-label="英語を話して答える"
                >
                  {listening ? "●" : "🎤"}
                </button>
                {transcript && (
                  <p className="spokenText">
                    聞き取った英語：<b>{transcript}</b>
                  </p>
                )}
                {answered && state.room.status === "question" && (
                  <p className="answered">
                    発音を送信しました。答え合わせを待ってね！
                  </p>
                )}
                {state.room.status === "reveal" && (
                  <p className="explanation">
                    <b>
                      {selected === 0
                        ? "発音できました！ NICE!"
                        : "もう一度ゆっくり言ってみよう"}
                    </b>
                    <span>{q.explanation}</span>
                  </p>
                )}
              </div>
            ) : (
              <div className="answerGrid playerGrid">
                {q.options.map((o, i) => (
                  <button
                    disabled={
                      selected !== null || state.room.status === "reveal"
                    }
                    className={`answer ${colors[i]} ${selected === i ? "picked" : ""} ${state.room.status === "reveal" && q.answer === i ? "winner" : ""}`}
                    onClick={() => answer(i)}
                    key={i}
                  >
                    <i>{String.fromCharCode(65 + i)}</i>
                    <b>{o}</b>
                  </button>
                ))}
                {answered && state.room.status === "question" && (
                  <p className="answered">
                    回答ロック！結果発表をお楽しみに ✨
                  </p>
                )}
                {state.room.status === "reveal" && (
                  <p className="explanation">
                    <b>
                      {q.answer === selected
                        ? "正解！ NICE!"
                        : "正解は " + q.options[q.answer ?? 0]}
                    </b>
                    <span>{q.explanation}</span>
                  </p>
                )}
              </div>
            )}
            {!isHost && state.room.status === "reveal" && lastResult && (
              <div className={`awardReveal ${lastResult.correct ? "success" : "miss"}`}>
                <span>{lastResult.correct ? speedTitle(lastResult.speedPoints) : "KEEP GOING!"}</span>
                <strong>{lastResult.points > 0 ? `+${lastResult.points.toLocaleString()}` : lastResult.points.toLocaleString()}<small> pts</small></strong>
                <div>
                  <i>正解・速度 {lastResult.speedPoints.toLocaleString()}</i>
                  {lastResult.streakBonus > 0 && <i>🔥 コンボ +{lastResult.streakBonus}</i>}
                  {lastResult.modeBonus !== 0 && <i>🎮 モード効果 {lastResult.modeBonus > 0 ? "+" : ""}{lastResult.modeBonus}</i>}
                  {lastResult.boost && <i>✦ BOOST ×1.5</i>}
                </div>
                {lastResult.streak >= 2 && <b>{lastResult.streak}問連続正解！</b>}
              </div>
            )}
            {state.room.status === "reveal" && (
              <div className="liveRanking">
                <b>現在のランキング</b>
                {state.players.slice(0, 5).map((player, rank) => (
                  <span key={player.id} className={player.id === playerId ? "me" : ""}>
                    <strong>{rank + 1}</strong>{player.name}<i>{player.score.toLocaleString()}点</i>
                  </span>
                ))}
              </div>
            )}
          </section>
        )}
      {state.room.status === "finished" && (
        <section className="final">
          {state.room.gameMode === "boss" && state.boss && (
            <div className={`bossResult ${state.boss.hp === 0 ? "win" : "lose"}`}>
              <b>{state.boss.hp === 0 ? "🎉 BOSS DEFEATED!" : "👾 BOSS SURVIVED..."}</b>
              <span>{state.boss.hp === 0 ? "クラス全員の勝利！" : `あと${state.boss.hp}ダメージでした`}</span>
            </div>
          )}
          <span>FINAL RANKING</span>
          <h1>最終結果</h1>
          <div className="podium">
            <div className="rankingHead">
              <strong>順位</strong>
              <b>名前</b>
              <span>得点</span>
            </div>
            {state.players.slice(0, 10).map((p, i) => (
              <div className={p.id === playerId ? "me" : ""} key={p.id}>
                <strong>{i + 1}</strong>
                <b>{p.name}</b>
                <span>{p.score.toLocaleString()}点</span>
              </div>
            ))}
          </div>
          <button className="bigAction" onClick={reset}>
            {isHost ? "新しいクイズを作る" : "トップへ戻る"}
          </button>
        </section>
      )}
      {notice && <p className="floatingNotice">{notice}</p>}
    </main>
  );
}
function clientId() {
  let x = localStorage.getItem("speakup-client-id");
  if (!x) {
    x = crypto.randomUUID();
    localStorage.setItem("speakup-client-id", x);
  }
  return x;
}
function message(e: unknown) {
  return e instanceof Error ? e.message : "エラーが発生しました。";
}
function speedTitle(points: number) {
  return points >= 900
    ? "⚡ LIGHTNING!"
    : points >= 700
      ? "🚀 SPEEDY!"
      : "✨ CORRECT!";
}
function bossPhase(boss: { hp: number; maxHp: number }) {
  if (boss.hp <= 0) return "down";
  const ratio = boss.hp / boss.maxHp;
  return ratio > 0.65 ? "strong" : ratio > 0.3 ? "hurt" : "critical";
}
function bossImage(boss: { hp: number; maxHp: number }) {
  const phase = bossPhase(boss);
  return phase === "strong" ? "/boss/boss-strong.webp" : phase === "hurt" ? "/boss/boss-hurt.webp" : "/boss/boss-critical.webp";
}
function bossCaption(phase: string, language: "ja" | "en") {
  if (language === "ja") return phase === "strong" ? "その程度では、私には勝てないぞ！" : phase === "hurt" ? "やるな…だが、まだ終わらん！" : phase === "critical" ? "ま、待て！お前たち、強すぎる！" : "見事だ…みんなの英語力の勝利だ！";
  return phase === "strong" ? "Your words cannot defeat me!" : phase === "hurt" ? "Not bad... Keep trying!" : phase === "critical" ? "Wait... You are too strong!" : "You mastered English together!";
}
function bossMoodLine(phase: string) {
  return phase === "strong" ? "自信満々。みんなの英語力を試している" : phase === "hurt" ? "少し焦っている。あと一押し！" : phase === "critical" ? "かなり弱っている。総攻撃のチャンス！" : "撃破成功！チームワークの勝利";
}
function bossVoiceLine(phase: string, language: "ja" | "en") {
  if (language === "ja") return phase === "strong" ? "その程度では、私には勝てないぞ。クラスの力を見せてみろ！" : phase === "hurt" ? "やるな。だが、まだまだ終わらんぞ！" : phase === "critical" ? "ま、待て！お前たち、強すぎる！もう持ちこたえられない！" : "見事だ。みんなで英語を極めたな。勝利はお前たちのものだ！";
  return phase === "strong" ? "Your words cannot defeat me! Show me what your class can do!" : phase === "hurt" ? "Not bad! Your English is stronger than I expected." : phase === "critical" ? "Wait! You are too strong! I cannot hold on much longer!" : "Impossible! You mastered English together. The victory is yours!";
}
function bossReactionLine(result: "hit" | "miss", language: "ja" | "en") {
  if (language === "ja") return result === "hit" ? "ぐあっ！いい攻撃だ！" : "まだまだだな。次こそ当ててみろ！";
  return result === "hit" ? "Agh! That was a good attack!" : "Not quite! Try to hit me next time!";
}
async function playBossVoice(text: string, language: "ja" | "en") {
  try {
    const response = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, speed: "normal", style: "boss", language }) });
    if (!response.ok) throw new Error();
    const audio = new Audio(URL.createObjectURL(await response.blob()));
    audio.volume = 0.9;
    await audio.play();
  } catch {
    if (!("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "ja" ? "ja-JP" : "en-US"; utterance.rate = language === "ja" ? 1.02 : 0.92; utterance.pitch = 0.65;
    speechSynthesis.cancel(); speechSynthesis.speak(utterance);
  }
}
function emptyQuestion(): Question {
  return {
    type: "grammar",
    question: "",
    options: ["", "", "", ""],
    answer: 0,
    explanation: "",
  };
}
function speechMatches(heard: string, expected: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9' ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const actual = normalize(heard),
    target = normalize(expected);
  if (!actual || !target) return false;
  if (actual === target) return true;
  const actualWords = actual.split(" "),
    targetWords = target.split(" ");
  return (
    targetWords.filter((word) => actualWords.includes(word)).length /
      targetWords.length >=
    0.75
  );
}
function offlineQuiz(unit: string): Question[] {
  const past = [
    ["空欄に入る語を選びなさい：I (  ) tennis yesterday.", ["play", "plays", "played", "playing"], 2, "yesterdayがあるので過去形playedを使います。"],
    ["空欄に入る語を選びなさい：She (  ) TV last night.", ["watch", "watches", "watched", "watching"], 2, "last nightがあるのでwatchedです。"],
    ["空欄に入る語を選びなさい：We (  ) to school yesterday.", ["go", "went", "gone", "going"], 1, "goの過去形はwentです。"],
    ["空欄に入る語を選びなさい：He (  ) breakfast at seven.", ["eat", "ate", "eats", "eating"], 1, "eatの過去形はateです。"],
    ["正しい疑問文を選びなさい。", ["Did you study English?", "Do you studied English?", "Did you studied English?", "Were you study English?"], 0, "過去の疑問文はDid＋主語＋動詞の原形です。"],
    ["空欄に入る語を選びなさい：I was (  ) a book then.", ["read", "reads", "reading", "to read"], 2, "過去進行形はwas＋動詞ingです。"],
    ["空欄に入る語を選びなさい：They were (  ) soccer.", ["play", "played", "playing", "plays"], 2, "過去進行形はwere＋動詞ingです。"],
    ["『私は昨日忙しかった』に合う英文を選びなさい。", ["I am busy yesterday.", "I was busy yesterday.", "I were busy yesterday.", "I did busy yesterday."], 1, "be動詞の過去形wasを使います。"],
    ["空欄に入る語を選びなさい：My mother (  ) dinner yesterday.", ["cook", "cooked", "cooks", "cooking"], 1, "規則動詞cookの過去形はcookedです。"],
    ["正しい否定文を選びなさい。", ["I did not play tennis.", "I not played tennis.", "I did not played tennis.", "I was not play tennis."], 0, "過去の否定文はdid not＋動詞の原形です。"],
  ];
  const basic = [
    ["空欄に入る語を選びなさい：I (  ) English every day.", ["study", "studies", "studied", "studying"], 0, "主語がIなので動詞はstudyです。"],
    ["空欄に入る語を選びなさい：She (  ) music.", ["like", "likes", "liked", "liking"], 1, "主語がSheなのでlikesです。"],
    ["正しい英文を選びなさい。", ["He can swim.", "He can swims.", "He cans swim.", "He can swimming."], 0, "canの後ろは動詞の原形です。"],
    ["空欄に入る語を選びなさい：We are (  ) soccer now.", ["play", "played", "playing", "plays"], 2, "現在進行形はbe動詞＋動詞ingです。"],
    ["『あなたは本を読みますか』に合う英文を選びなさい。", ["Do you read books?", "Are you read books?", "Does you read books?", "Did you reads books?"], 0, "一般動詞の疑問文ではDoを使います。"],
  ];
  const source = /過去/.test(unit) ? past : [...basic, ...basic];
  return source.slice(0, 10).map(([question, options, answer, explanation]) => ({
    type: "grammar",
    question: String(question),
    options: options as string[],
    answer: Number(answer),
    explanation: String(explanation),
  }));
}
