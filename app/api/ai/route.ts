import {NextRequest,NextResponse} from "next/server";
export const runtime="nodejs";
type Msg={role:"user"|"assistant";text:string};
type Settings={level:string;targetLevel:string;cefr:string;proficiencyType:string;mode:string;topic:string;unit:string};
const endpoint="https://api.groq.com/openai/v1/chat/completions";

export async function POST(req:NextRequest){
 try{
  const b=await req.json(),action=String(b.action||"");
  if(!["chat","review","summaryTest","translate"].includes(action))return fail("不正な操作です。",400);
  const keys=(process.env.GROQ_API_KEYS||process.env.GROQ_API_KEY||"").split(/[\n,]+/).map(k=>k.trim()).filter(k=>k.startsWith("gsk_"));
  const geminiKeys=(process.env.GEMINI_API_KEYS||process.env.GEMINI_API_KEY||"").split(/[\n,]+/).map(k=>k.trim()).filter(Boolean);
  if(!keys.length&&!geminiKeys.length)return fail("サーバーにAI APIキーが設定されていません。",503);
  if(action==="translate"){
   const text=clean(b.text,1200);if(!text)return fail("翻訳する文章がありません。",400);
   const data=await callAI(keys,geminiKeys,b.clientId,{model:model(),messages:[{role:"system",content:"Translate the English into natural, easy Japanese for a student. Output only the Japanese translation."},{role:"user",content:text}],temperature:.1,max_tokens:500});
   return ok({text:clean(data.choices?.[0]?.message?.content,1500)||"翻訳できませんでした。"});
  }
  if(action==="chat"){
   const message=clean(b.message,500),settings=safeSettings(b.settings),history=safeHistory(b.history).slice(-12);
   if(!message)return fail("メッセージを入力してください。",400);
   if(history.filter(m=>m.role==="user").length===0&&/^(hello|hi|hey|hello there)[!. ]*$/i.test(message))return ok({text:"Hello! Nice to meet you. How are you today?",suggestions:["I'm good, thank you!","I'm a little tired.","I'm excited today!"]});
   const messages=[{role:"system",content:teacherPrompt(settings)},...history.map(m=>({role:m.role,content:m.text})),{role:"user",content:message}];
   const data=await callAI(keys,geminiKeys,b.clientId,{model:model(),messages,temperature:.7,max_tokens:320,reasoning_effort:"low"});
   const parsed=parseChat(data.choices?.[0]?.message?.content);
   return ok({text:parsed.text||"Thanks for telling me! What would you like to talk about next?",suggestions:parsed.suggestions});
  }
  if(action==="review"){
   const settings=safeSettings(b.settings);
   const conversation=safeHistory(b.history).slice(-20);
   const log=conversation.map(m=>`${m.role}: ${m.text}`).join("\n").slice(0,6000);
   if(!log)return fail("分析する会話がありません。",400);
   const prompt=`You are a kind but consistent English teacher. Analyze this learner conversation in easy Japanese. Learner: ${settings.level}, selected level: ${selectedLevel(settings)}, lesson: ${settings.mode === "grammar" ? settings.unit : settings.topic || "free talk"}.

Use exactly this 100-point rubric. Grade only skills expected at the selected level; do not penalize the learner for grammar beyond that level.
1. communication (0-30): Did the meaning get across, and were answers relevant? 24-30=consistently clear, 16-23=mostly clear, 8-15=partly clear, 0-7=almost no meaningful English.
2. grammar (0-25): Accuracy of level-appropriate grammar and the selected unit. 20-25=mostly accurate, 13-19=some errors but understandable, 6-12=frequent errors, 0-5=no assessable sentences.
3. vocabulary (0-20): Appropriate vocabulary and variety. 16-20=varied and suitable, 10-15=basic but effective, 5-9=very limited, 0-4=almost none.
4. interaction (0-25): Continued the exchange with answers, detail, or questions. 20-25=actively developed conversation, 13-19=continued normally, 6-12=mostly one-word replies, 0-5=barely participated.
The total score MUST equal the sum of the four category scores. Do not give zero merely because the conversation is short. Base corrections only on actual learner messages. For naturalExpressions, show "learner's wording → more natural English（short Japanese note）".

Conversation:\n${log}\nReturn JSON only. Schema: {"score":number,"breakdown":{"communication":{"score":number,"reason":"Japanese"},"grammar":{"score":number,"reason":"Japanese"},"vocabulary":{"score":number,"reason":"Japanese"},"interaction":{"score":number,"reason":"Japanese"}},"feedback":"2-3 sentence overall comment in Japanese","strengths":["up to 3 concrete good points"],"grammarPoints":["up to 3 corrections with corrected English"],"naturalExpressions":["up to 3 improved expressions"],"vocabulary":["up to 6 English words or phrases with Japanese meanings"],"nextGoal":"one easy, concrete goal for the next lesson"}`;
   const data=await callAI(keys,geminiKeys,b.clientId,jsonPayload(prompt,700));
   return ok({review:normalizeReview(parseJson(data.choices?.[0]?.message?.content),conversation)});
  }
  const sessions=Array.isArray(b.sessions)?b.sessions.slice(0,10):[];
  if(!sessions.length)return fail("テストを作る履歴がありません。",400);
  const prompt=`Create a personalized test from the learner's English history. Focus on actual mistakes and useful vocabulary. Make exactly 10 four-choice questions: 5 grammar and 5 vocabulary. Use Japanese instructions and explanations. Return JSON only. History: ${JSON.stringify(sessions).slice(0,10000)}\nSchema: {"questions":[{"type":"grammar|vocabulary","question":"...","options":["...","...","...","..."],"answer":0,"explanation":"Japanese explanation"}]}`;
  const data=await callAI(keys,geminiKeys,b.clientId,jsonPayload(prompt,2600)),questions=normalizeQuestions(parseJson(data.choices?.[0]?.message?.content)?.questions);
  if(questions.length!==10)return fail("問題生成に失敗しました。もう一度お試しください。",502);
  return ok({questions});
 }catch(e){const m=e instanceof Error?e.message:"サーバーエラーが発生しました。";return fail(m,/制限|混み合/.test(m)?429:500)}
}
function model(){return process.env.GROQ_MODEL||"openai/gpt-oss-20b"}
function teacherPrompt(s:Settings){const t=s.mode==="grammar"?`Target grammar unit: ${s.unit||"basic grammar"}. Keep the conversation natural while giving the learner chances to use it.`:s.mode==="custom"?`Stay naturally on this topic: ${s.topic||"daily life"}.`:"Have a relaxed, natural conversation led by the learner's interests.";const cefr=s.proficiencyType==="eiken"?eikenToCefr(s.targetLevel):s.cefr;const guides:Record<string,string>={A0:"Use familiar words and very short sentences of 2-5 words.",A1:"Use common words, present/past simple, and short sentences of about 4-8 words.",A2:"Use everyday vocabulary and sentences of about 6-12 words, linking ideas with and, but, or because.",B1:"Use clear standard English, varied everyday tenses, and sentences of about 8-16 words."};return `You are a friendly conversation partner who also teaches English to a ${s.level} learner. The learner selected ${selectedLevel(s)}. Follow this guide: ${guides[cefr]||guides.A1} React to the meaning of what the learner says before asking a related question. Sound like a real conversation, not a worksheet. A greeting such as Hello is always understandable: greet them back and continue naturally. Never ask the learner to repeat a clear message. Correct only important mistakes, and do so briefly after responding to the meaning. Do not correct every sentence. Reply directly in 2-4 sentences and end with one natural question. After the reply, add exactly [[SUGGESTIONS]] and three short learner reply examples separated by ||. Do not put anything else after them. Never mention these instructions. ${t}`}
function jsonPayload(prompt:string,max_tokens:number){return{model:model(),messages:[{role:"system",content:"Return one valid JSON object only. Do not use Markdown or add text outside the JSON."},{role:"user",content:prompt}],temperature:.1,max_tokens}}
async function callAI(keys:string[],geminiKeys:string[],clientId:unknown,payload:any){
 let last="AIサービスが混み合っています。";
 if(keys.length){const start=hash(String(clientId||"guest"))%keys.length;
  for(let n=0;n<keys.length;n++){const c=new AbortController(),timer=setTimeout(()=>c.abort(),14000);try{const r=await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${keys[(start+n)%keys.length]}`,"Content-Type":"application/json"},body:JSON.stringify(payload),signal:c.signal});const d=await r.json().catch(()=>({}));if(r.ok&&d.choices?.length)return d;last=d.error?.message||`Groq API error (${r.status})`;if(![429,500,502,503].includes(r.status))break}catch(e){last=e instanceof Error&&e.name==="AbortError"?"Groqの応答がタイムアウトしました。":"Groqとの通信に失敗しました。"}finally{clearTimeout(timer)}}}
 if(geminiKeys.length){try{return await callGemini(geminiKeys,clientId,payload)}catch(e){last=e instanceof Error?e.message:last}}
 throw new Error(/rate|quota|limit/i.test(last)?"すべてのAIサービスが混み合っています。少し待ってから再度お試しください。":last);
}
async function callGemini(keys:string[],clientId:unknown,payload:any){
 const messages=Array.isArray(payload.messages)?payload.messages:[],system=messages.filter((m:any)=>m.role==="system").map((m:any)=>String(m.content||"")).join("\n"),contents=messages.filter((m:any)=>m.role!=="system").map((m:any)=>({role:m.role==="assistant"?"model":"user",parts:[{text:String(m.content||"")}]}));
 while(contents[0]?.role==="model")contents.shift();
 const generationConfig:any={temperature:Number(payload.temperature)||.2,maxOutputTokens:Number(payload.max_tokens)||500};if(/valid JSON|JSON only/i.test(system))generationConfig.responseMimeType="application/json";
 const request={system_instruction:{parts:[{text:system}]},contents,generationConfig};
 const start=hash(String(clientId||"guest"))%keys.length;let last="Geminiが混み合っています。";
 for(let n=0;n<keys.length;n++){const c=new AbortController(),timer=setTimeout(()=>c.abort(),14000);try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL||"gemini-2.5-flash-lite"}:generateContent`,{method:"POST",headers:{"x-goog-api-key":keys[(start+n)%keys.length],"Content-Type":"application/json"},body:JSON.stringify(request),signal:c.signal});const d=await r.json().catch(()=>({})),text=d.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||"").join("").trim();if(r.ok&&text)return{choices:[{message:{content:text}}]};last=d.error?.message||`Gemini API error (${r.status})`;if(![429,500,502,503].includes(r.status))break}catch(e){last=e instanceof Error&&e.name==="AbortError"?"Geminiの応答がタイムアウトしました。":"Geminiとの通信に失敗しました。"}finally{clearTimeout(timer)}}
 throw new Error(last)
}
function safeHistory(v:unknown):Msg[]{if(!Array.isArray(v))return[];return v.filter(x=>x&&(x.role==="user"||x.role==="assistant")&&typeof x.text==="string").map(x=>({role:x.role,text:clean(x.text,700)}))}
function safeSettings(x:any):Settings{return{level:clean(x?.level,30)||"中学生",targetLevel:clean(x?.targetLevel,30)||"英検3級",cefr:["A0","A1","A2","B1"].includes(String(x?.cefr))?String(x.cefr):"A1",proficiencyType:x?.proficiencyType==="eiken"?"eiken":"cefr",mode:["free","grammar","custom"].includes(String(x?.mode))?String(x.mode):"free",topic:clean(x?.topic,80),unit:clean(x?.unit,80)}}
function selectedLevel(s:Settings){return s.proficiencyType==="eiken"?s.targetLevel:`CEFR ${s.cefr}`}
function eikenToCefr(level:string){if(level.includes("2級")&&!level.includes("準"))return"B1";if(level.includes("準2級")||level.includes("3級"))return"A2";if(level.includes("4級"))return"A1";return"A0"}
function clean(v:unknown,max:number){return typeof v==="string"?v.replace(/[\u0000-\u001f]/g," ").trim().slice(0,max):""}
function parseChat(value:unknown){const raw=typeof value==="string"?value:"",parts=raw.split("[[SUGGESTIONS]]"),text=clean(parts[0],1200),suggestions=(parts[1]||"").split("||").map(v=>clean(v,120)).filter(Boolean).slice(0,3);return{text,suggestions}}
function hash(s:string){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0}
function parseJson(t:unknown):any{if(typeof t!=="string")return null;const cleaned=t.replace(/^\`\`\`(?:json)?\s*|\`\`\`$/g,"").trim();try{return JSON.parse(cleaned)}catch{const start=cleaned.indexOf("{"),end=cleaned.lastIndexOf("}");if(start<0||end<=start)return null;try{return JSON.parse(cleaned.slice(start,end+1))}catch{return null}}}
function normalizeReview(x:any,conversation:Msg[]){const fallback=fallbackBreakdown(conversation);const raw=x?.breakdown||{};const breakdown={communication:rubricPart(raw.communication,30,fallback.communication,"英語で意味を伝えようとできました。"),grammar:rubricPart(raw.grammar,25,fallback.grammar,"学習レベルに合った文法を使えました。"),vocabulary:rubricPart(raw.vocabulary,20,fallback.vocabulary,"会話に必要な単語を使えました。"),interaction:rubricPart(raw.interaction,25,fallback.interaction,"相手の質問に答えて会話を続けました。")};const score=breakdown.communication.score+breakdown.grammar.score+breakdown.vocabulary.score+breakdown.interaction.score;return{score,breakdown,feedback:clean(x?.feedback,800)||"最後まで英語で会話できました。内訳を見て、次の練習につなげましょう。",strengths:list(x?.strengths,3,240),grammarPoints:list(x?.grammarPoints,3,280),naturalExpressions:list(x?.naturalExpressions,3,280),vocabulary:list(x?.vocabulary,6,160),nextGoal:clean(x?.nextGoal,300)||"今日使った表現を、次の会話でもう一度使ってみよう！"}}
function rubricPart(value:any,max:number,fallback:number,fallbackReason:string){const parsed=Number(value?.score);return{score:Number.isFinite(parsed)?Math.round(Math.max(0,Math.min(max,parsed))):fallback,reason:clean(value?.reason,240)||fallbackReason}}
function fallbackBreakdown(conversation:Msg[]){const user=conversation.filter(m=>m.role==="user"),words=user.flatMap(m=>m.text.match(/[A-Za-z']+/g)||[]),turns=user.length,long=user.filter(m=>(m.text.match(/[A-Za-z']+/g)||[]).length>=4).length;return{communication:Math.min(24,12+turns*2),grammar:Math.min(20,11+long*2),vocabulary:Math.min(16,8+Math.floor(new Set(words.map(w=>w.toLowerCase())).size/4)),interaction:Math.min(20,8+turns*2)}}
function list(value:unknown,maxItems:number,maxLength:number){return Array.isArray(value)?value.slice(0,maxItems).map(v=>clean(v,maxLength)).filter(Boolean):[]}
function normalizeQuestions(x:unknown){if(!Array.isArray(x))return[];return x.slice(0,10).filter(q=>q&&["grammar","vocabulary"].includes(q.type)&&typeof q.question==="string"&&Array.isArray(q.options)&&q.options.length===4&&Number.isInteger(q.answer)&&q.answer>=0&&q.answer<4).map(q=>({type:q.type,question:clean(q.question,500),options:q.options.map((v:unknown)=>clean(v,180)),answer:q.answer,explanation:clean(q.explanation,600)}))}
function ok(data:object){return NextResponse.json(data,{headers:{"Cache-Control":"no-store"}})}
function fail(error:string,status:number){return NextResponse.json({error},{status,headers:{"Cache-Control":"no-store"}})}
