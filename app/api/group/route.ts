import { NextRequest, NextResponse } from "next/server";
export const runtime = "nodejs";
type Question={question:string;options:string[];answer:number;explanation?:string};
const headers=()=>({apikey:process.env.SUPABASE_SERVICE_ROLE_KEY||"",Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY||""}`,"Content-Type":"application/json",Prefer:"return=representation"});

export async function POST(req:NextRequest){
 try{
  if(!process.env.NEXT_PUBLIC_SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return fail("みんなでクイズ用のSupabase設定が必要です。",503);
  const b=await req.json(),action=String(b.action||"");
  if(action==="create")return createRoom(b);
  if(action==="join")return joinRoom(b);
  if(action==="state")return roomState(b);
  if(action==="host")return hostAction(b);
  if(action==="submit")return submitAnswer(b);
  return fail("不正な操作です。",400);
 }catch(e){return fail(e instanceof Error?e.message:"サーバーエラーです。",500)}
}
async function db(path:string,init:RequestInit={}){
 const r=await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`,{...init,headers:{...headers(),...(init.headers||{})},cache:"no-store"});
 const text=await r.text();let data:any=null;try{data=text?JSON.parse(text):null}catch{}
 if(!r.ok)throw new Error(data?.message||"データベースとの通信に失敗しました。");
 return data;
}
async function createRoom(b:any){
 const questions=safeQuestions(b.questions);if(questions.length<3)return fail("3問以上の問題が必要です。",400);
 const hostToken=crypto.randomUUID(),title=clean(b.title,60)||"英語文法クイズ";
 for(let i=0;i<6;i++){const code=String(Math.floor(100000+Math.random()*900000));try{
  const rows=await db("quiz_rooms",{method:"POST",body:JSON.stringify({code,host_token:hostToken,title,questions})});
  return ok({roomId:rows[0].id,code,hostToken});
 }catch(e){if(i===5)throw e}}
 return fail("ルームを作成できませんでした。",500);
}
async function joinRoom(b:any){
 const code=clean(b.code,6),name=clean(b.name,16);if(!/^\d{6}$/.test(code)||!name)return fail("6桁の参加コードとニックネームを入力してください。",400);
 const rooms=await db(`quiz_rooms?code=eq.${encodeURIComponent(code)}&status=eq.lobby&select=id,title`);
 if(!rooms.length)return fail("参加できるルームが見つかりません。",404);
 const players=await db(`quiz_players?room_id=eq.${rooms[0].id}&select=id`);if(players.length>=40)return fail("このルームは40人で満員です。",409);
 const created=await db("quiz_players",{method:"POST",body:JSON.stringify({room_id:rooms[0].id,name})});
 return ok({roomId:rooms[0].id,playerId:created[0].id,title:rooms[0].title});
}
async function roomState(b:any){
 const roomId=id(b.roomId);if(!roomId)return fail("ルームが見つかりません。",400);
 const rooms=await db(`quiz_rooms?id=eq.${roomId}&select=*`);if(!rooms.length)return fail("ルームが終了したか、見つかりません。",404);
 const room=rooms[0],isHost=String(b.hostToken||"")===room.host_token,qs=safeQuestions(room.questions),index=Number(room.current_question),q=qs[index];
 const players=await db(`quiz_players?room_id=eq.${roomId}&select=id,name,score,streak&order=score.desc,joined_at.asc`);
 const answers=index>=0?await db(`quiz_answers?room_id=eq.${roomId}&question_index=eq.${index}&select=player_id,option_index,correct,points`):[];
 const publicQuestion=q?{question:q.question,options:q.options,...((room.status==="reveal"||room.status==="finished"||isHost)?{answer:q.answer,explanation:q.explanation||""}:{})}:null;
 return ok({room:{id:room.id,code:room.code,title:room.title,status:room.status,currentQuestion:index,totalQuestions:qs.length,question:publicQuestion,questionStartedAt:room.question_started_at},players,answeredPlayerIds:answers.map((a:any)=>a.player_id),answerCount:answers.length,...(isHost?{questions:qs}:{})});
}
async function hostAction(b:any){
 const roomId=id(b.roomId),token=clean(b.hostToken,80),command=String(b.command||"");
 const rooms=await db(`quiz_rooms?id=eq.${roomId}&host_token=eq.${encodeURIComponent(token)}&select=*`);if(!rooms.length)return fail("先生用の操作権限がありません。",403);
 const room=rooms[0],total=safeQuestions(room.questions).length;let patch:any={};
 if(command==="start")patch={status:"question",current_question:0,question_started_at:new Date().toISOString()};
 else if(command==="reveal")patch={status:"reveal"};
 else if(command==="next"){const next=Number(room.current_question)+1;patch=next>=total?{status:"finished"}:{status:"question",current_question:next,question_started_at:new Date().toISOString()};}
 else if(command==="finish")patch={status:"finished"};else return fail("操作が正しくありません。",400);
 await db(`quiz_rooms?id=eq.${roomId}`,{method:"PATCH",body:JSON.stringify(patch)});return ok({success:true});
}
async function submitAnswer(b:any){
 const roomId=id(b.roomId),playerId=id(b.playerId),option=Number(b.optionIndex),questionIndex=Number(b.questionIndex);
 const rooms=await db(`quiz_rooms?id=eq.${roomId}&status=eq.question&select=questions,current_question,question_started_at`);if(!rooms.length||rooms[0].current_question!==questionIndex)return fail("この問題の回答時間は終了しました。",409);
 const players=await db(`quiz_players?id=eq.${playerId}&room_id=eq.${roomId}&select=score,streak`);if(!players.length)return fail("参加者を確認できません。",403);
 const q=safeQuestions(rooms[0].questions)[questionIndex];if(!q||option<0||option>3)return fail("回答が正しくありません。",400);
 const correct=option===q.answer,elapsed=Math.max(0,Date.now()-new Date(rooms[0].question_started_at).getTime()),points=correct?Math.max(400,1000-Math.floor(elapsed/30)):0,streak=correct?Number(players[0].streak)+1:0,bonus=correct?Math.min(streak*25,150):0;
 try{await db("quiz_answers",{method:"POST",body:JSON.stringify({room_id:roomId,player_id:playerId,question_index:questionIndex,option_index:option,correct,points:points+bonus})});}
 catch{return fail("すでに回答しています。",409)}
 await db(`quiz_players?id=eq.${playerId}`,{method:"PATCH",body:JSON.stringify({score:Number(players[0].score)+points+bonus,streak})});
 return ok({correct,points:points+bonus});
}
function safeQuestions(v:any):Question[]{return Array.isArray(v)?v.slice(0,20).filter(q=>q&&typeof q.question==="string"&&Array.isArray(q.options)&&q.options.length===4&&Number.isInteger(q.answer)&&q.answer>=0&&q.answer<4).map(q=>({question:clean(q.question,300),options:q.options.map((x:any)=>clean(x,120)),answer:q.answer,explanation:clean(q.explanation,300)})):[]}
function clean(v:any,max:number){return typeof v==="string"?v.replace(/[\u0000-\u001f]/g," ").trim().slice(0,max):""}
function id(v:any){const s=String(v||"");return /^[0-9a-f-]{36}$/i.test(s)?s:""}
function ok(data:any){return NextResponse.json(data,{headers:{"Cache-Control":"no-store"}})}
function fail(error:string,status:number){return NextResponse.json({error},{status})}
