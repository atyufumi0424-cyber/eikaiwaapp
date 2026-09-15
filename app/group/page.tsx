"use client";
import {FormEvent,useEffect,useState} from "react";
import "./group.css";
type Question={question:string;options:string[];answer?:number;explanation?:string};
type Player={id:string;name:string;score:number;streak:number};
type State={room:{id:string;code:string;title:string;status:"lobby"|"question"|"reveal"|"finished";currentQuestion:number;totalQuestions:number;question:Question|null};players:Player[];answeredPlayerIds:string[];answerCount:number;questions?:Question[]};
const grades=["中学1年生","中学2年生","中学3年生","高校生"];
const units:Record<string,string[]>={"中学1年生":["be動詞","一般動詞","疑問文・否定文","can","現在進行形","過去形"],"中学2年生":["過去形・過去進行形","未来表現","助動詞","不定詞","動名詞","比較級・最上級","接続詞","受け身"],"中学3年生":["現在完了","不定詞の応用","分詞","関係代名詞","間接疑問文","仮定法"],"高校生":["時制","助動詞","受動態","不定詞・動名詞","関係詞","比較","仮定法"]};
const colors=["red","blue","yellow","green"];

export default function GroupQuiz(){
 const [role,setRole]=useState<""|"host"|"player">("");
 const [grade,setGrade]=useState("中学2年生"),[unit,setUnit]=useState("過去形・過去進行形"),[level,setLevel]=useState("A1");
 const [questions,setQuestions]=useState<Question[]>([]),[loading,setLoading]=useState(false),[notice,setNotice]=useState("");
 const [roomId,setRoomId]=useState(""),[hostToken,setHostToken]=useState(""),[playerId,setPlayerId]=useState(""),[state,setState]=useState<State|null>(null);
 const [code,setCode]=useState(""),[name,setName]=useState(""),[selected,setSelected]=useState<number|null>(null);
 useEffect(()=>{if(!roomId)return;const load=()=>void getState();load();const timer=setInterval(load,1500);return()=>clearInterval(timer)},[roomId,hostToken]);
 useEffect(()=>setSelected(null),[state?.room.currentQuestion]);

 async function api(path:string,data:any){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}),j=await r.json();if(!r.ok)throw new Error(j.error||"通信に失敗しました。");return j}
 async function getState(){try{setState(await api("/api/group",{action:"state",roomId,hostToken}))}catch(e){setNotice(message(e))}}
 async function generate(){setLoading(true);setNotice("AIが問題を作っています…");try{const j=await api("/api/ai",{action:"groupQuiz",settings:{level:grade,targetLevel:"英検3級",cefr:level,proficiencyType:"cefr",mode:"grammar",topic:"",unit,showHints:false,showTranslations:false},count:10,clientId:clientId()});setQuestions(j.questions);setNotice("")}catch(e){setNotice(message(e))}finally{setLoading(false)}}
 async function create(){if(questions.length<3)return;setLoading(true);try{const j=await api("/api/group",{action:"create",title:`${unit}クイズ`,questions});setRoomId(j.roomId);setHostToken(j.hostToken);setNotice("")}catch(e){setNotice(message(e))}finally{setLoading(false)}}
 async function join(e:FormEvent){e.preventDefault();setLoading(true);try{const j=await api("/api/group",{action:"join",code,name});setRoomId(j.roomId);setPlayerId(j.playerId);setNotice("")}catch(e){setNotice(message(e))}finally{setLoading(false)}}
 async function command(command:string){setLoading(true);try{await api("/api/group",{action:"host",roomId,hostToken,command});await getState()}catch(e){setNotice(message(e))}finally{setLoading(false)}}
 async function answer(index:number){if(selected!==null||!state)return;setSelected(index);try{await api("/api/group",{action:"submit",roomId,playerId,questionIndex:state.room.currentQuestion,optionIndex:index})}catch(e){setNotice(message(e))}}
 function reset(){setRole("");setRoomId("");setHostToken("");setPlayerId("");setState(null);setQuestions([]);setSelected(null);setNotice("")}

 if(!role)return <main className="groupApp"><header className="groupTop"><a href="/">← SpeakUp!</a><b>みんなで文法クイズ</b></header><section className="groupHero"><span>LIVE GRAMMAR QUIZ</span><h1>クラスみんなで<br/>英語に挑戦！</h1><p>先生が出す問題に、参加コードで最大40人まで参加できます。</p><div className="roleCards"><button onClick={()=>setRole("host")}><i>🧑‍🏫</i><b>先生として作る</b><small>AIで問題を作り、ゲームを進行</small></button><button onClick={()=>setRole("player")}><i>🙋</i><b>参加する</b><small>6桁のコードを入力して回答</small></button></div></section></main>;

 if(role==="host"&&!roomId)return <main className="groupApp"><header className="groupTop"><button onClick={reset}>← 戻る</button><b>先生用クイズ作成</b></header><section className="hostSetup"><h1>文法クイズを作る</h1><label>学年<div className="pills">{grades.map(g=><button className={grade===g?"on":""} onClick={()=>{setGrade(g);setUnit(units[g][0])}} key={g}>{g}</button>)}</div></label><label>英語レベル<div className="pills">{["A0","A1","A2","B1"].map(v=><button className={level===v?"on":""} onClick={()=>setLevel(v)} key={v}>{v}</button>)}</div></label><label>出題単元<div className="pills">{units[grade].map(v=><button className={unit===v?"on":""} onClick={()=>setUnit(v)} key={v}>{v}</button>)}</div></label><button className="bigAction" onClick={generate} disabled={loading}>{loading?"作成中…":"✨ AIで10問作る"}</button>{notice&&<p className="groupNotice">{notice}</p>}{questions.length>0&&<div className="preview"><div><h2>問題を確認</h2><span>{questions.length}問</span></div>{questions.map((q,i)=><details key={i}><summary>{i+1}. {q.question}</summary><ol>{q.options.map((o,j)=><li className={j===q.answer?"correct":""} key={j}>{o}</li>)}</ol><small>{q.explanation}</small></details>)}<button className="bigAction" onClick={create} disabled={loading}>この問題でルームを作る</button></div>}</section></main>;

 if(role==="player"&&!roomId)return <main className="groupApp joinScreen"><header className="groupTop"><button onClick={reset}>← 戻る</button><b>クイズに参加</b></header><form onSubmit={join} className="joinCard"><i>🎮</i><h1>参加コードを入力</h1><input inputMode="numeric" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,""))} placeholder="123456"/><input maxLength={16} value={name} onChange={e=>setName(e.target.value)} placeholder="ニックネーム"/><button disabled={code.length!==6||!name.trim()||loading}>{loading?"参加中…":"参加する"}</button>{notice&&<p className="groupNotice">{notice}</p>}</form></main>;

 if(!state)return <main className="groupApp loadingScreen">読み込み中…</main>;
 const isHost=role==="host",q=state.room.question,answered=state.answeredPlayerIds.includes(playerId);
 return <main className="groupApp gameScreen"><header className="gameHeader"><b>{state.room.title}</b><span>参加コード <strong>{state.room.code}</strong></span><span>{state.players.length}/40人</span></header>
 {state.room.status==="lobby"&&<section className="lobby"><h1>{isHost?"参加を待っています":"先生が開始するまで待ってね！"}</h1><div className="codeBox"><small>参加コード</small><strong>{state.room.code}</strong><span>eikaiwaapp.vercel.app/group</span></div><div className="playerCloud">{state.players.map(p=><span key={p.id}>{p.name}</span>)}</div>{isHost&&<button className="bigAction" disabled={!state.players.length||loading} onClick={()=>command("start")}>クイズを開始する</button>}</section>}
 {(state.room.status==="question"||state.room.status==="reveal")&&q&&<section className="liveQuestion"><div className="questionTop"><span>Q{state.room.currentQuestion+1}/{state.room.totalQuestions}</span><b>{state.answerCount}/{state.players.length}人 回答</b></div><h1>{q.question}</h1>{isHost?<div className="hostAnswers"><div className="answerGrid">{q.options.map((o,i)=><div className={`answer ${colors[i]} ${state.room.status==="reveal"&&q.answer===i?"winner":""}`} key={i}><i>{["▲","◆","●","■"][i]}</i><b>{o}</b></div>)}</div><button className="bigAction" disabled={loading} onClick={()=>command(state.room.status==="question"?"reveal":"next")}>{state.room.status==="question"?"正解を発表":"次の問題へ"}</button></div>:<div className="answerGrid playerGrid">{q.options.map((o,i)=><button disabled={selected!==null||state.room.status==="reveal"} className={`answer ${colors[i]} ${selected===i?"picked":""} ${state.room.status==="reveal"&&q.answer===i?"winner":""}`} onClick={()=>answer(i)} key={i}><i>{["▲","◆","●","■"][i]}</i><b>{o}</b></button>)}{answered&&state.room.status==="question"&&<p className="answered">回答しました！ 正解発表を待ってね</p>}{state.room.status==="reveal"&&<p className="explanation"><b>{q.answer===selected?"正解！ 🎉":"正解は "+q.options[q.answer??0]}</b><span>{q.explanation}</span></p>}</div>}</section>}
 {state.room.status==="finished"&&<section className="final"><span>FINAL RANKING</span><h1>最終結果</h1><div className="podium">{state.players.slice(0,10).map((p,i)=><div className={p.id===playerId?"me":""} key={p.id}><strong>{i+1}</strong><b>{p.name}</b><span>{p.score.toLocaleString()}点</span></div>)}</div><button className="bigAction" onClick={reset}>{isHost?"新しいクイズを作る":"トップへ戻る"}</button></section>}
 {notice&&<p className="floatingNotice">{notice}</p>}</main>;
}
function clientId(){let x=localStorage.getItem("speakup-client-id");if(!x){x=crypto.randomUUID();localStorage.setItem("speakup-client-id",x)}return x}
function message(e:unknown){return e instanceof Error?e.message:"エラーが発生しました。"}
