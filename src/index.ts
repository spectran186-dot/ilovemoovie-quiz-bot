interface D1PreparedStatement {
  bind(...values: Array<string | number | boolean | null>): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { last_row_id?: number } }>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  ADMIN_IDS: string;
  CHANNEL_ID: string;
  CHANNEL_USERNAME: string;
  BOT_USERNAME: string;
  QUIZ_HOURS?: string;
  SESSION_MINUTES?: string;
}
type TgUser = { id:number; username?:string; first_name?:string; last_name?:string };
type TgMessage = { message_id:number; text?:string; from?:TgUser; chat:{id:number;type:string} };
type Update = { update_id:number; message?:TgMessage };
type Draft = { stage:string; title?:string; questions:Array<{prompt:string;answer:string;aliases:string[]}>; prompt?:string; answer?:string };
const POINTS:Record<number,number>={1:10,2:7,3:4};
const isoNow=()=>new Date().toISOString();
const norm=(s:string)=>s.toLocaleLowerCase("ru-RU").replace(/ё/g,"е").normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu," ").trim().replace(/\s+/g," ");
const admin=(env:Env,id:number)=>env.ADMIN_IDS.split(",").map(x=>x.trim()).filter(Boolean).includes(String(id));
const esc=(s:string)=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

async function tg(env:Env,method:string,body:Record<string,unknown>){
  const r=await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const data=await r.json() as {ok:boolean;result:any;description?:string};
  if(!r.ok||!data.ok) throw new Error(data.description||`Telegram API ${method} failed`);
  return data.result;
}
async function say(env:Env,chat_id:number,text:string,extra:Record<string,unknown>={}){
  return tg(env,"sendMessage",{chat_id,text,parse_mode:"HTML",...extra});
}
async function userUpsert(env:Env,u:TgUser){
  const name=[u.first_name,u.last_name].filter(Boolean).join(" ")||u.username||String(u.id);
  await env.DB.prepare("INSERT INTO users(id,username,full_name,private,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,full_name=excluded.full_name")
    .bind(u.id,u.username||null,name,0,isoNow()).run();
}
async function getDraft(env:Env,id:number):Promise<Draft|null>{
  const r=await env.DB.prepare("SELECT payload FROM admin_drafts WHERE admin_id=?").bind(id).first<{payload:string}>();
  return r?JSON.parse(r.payload) as Draft:null;
}
async function putDraft(env:Env,id:number,d:Draft|null){
  if(d) await env.DB.prepare("INSERT INTO admin_drafts(admin_id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(admin_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at").bind(id,JSON.stringify(d),isoNow()).run();
  else await env.DB.prepare("DELETE FROM admin_drafts WHERE admin_id=?").bind(id).run();
}
async function saveQuiz(env:Env,id:number,d:Draft){
  const result=await env.DB.prepare("INSERT INTO quizzes(title,status,created_at) VALUES(?,'draft',?)").bind(d.title||"",isoNow()).run();
  const quizId=Number(result.meta.last_row_id);
  for(let i=0;i<d.questions.length;i++){
    const q=d.questions[i];
    const qr=await env.DB.prepare("INSERT INTO questions(quiz_id,position,prompt,answer) VALUES(?,?,?,?)").bind(quizId,i+1,q.prompt,q.answer).run();
    const qid=Number(qr.meta.last_row_id);
    for(const a of q.aliases) await env.DB.prepare("INSERT INTO aliases(question_id,alias) VALUES(?,?)").bind(qid,a).run();
  }
  await putDraft(env,id,null);
  return quizId;
}
async function adminMessage(env:Env,m:TgMessage){
  const uid=m.from!.id, text=(m.text||"").trim(), chat=m.chat.id;
  const [cmd,...args]=text.split(/\s+/);
  // Participant commands must always bypass the admin draft wizard. Otherwise a\n  // command sent while a draft is open can accidentally become a title/question/answer.\n  if(cmd==="/start"||cmd==="/privacy"||cmd==="/leaderboard") return participantMessage(env,m);
  if(cmd==="/cancel"){await putDraft(env,uid,null);return say(env,chat,"Создание викторины отменено.");}
  if(cmd==="/newquiz"){await putDraft(env,uid,{stage:"title",questions:[]});return say(env,chat,"Создание викторины. Отправь её название.");}
  if(cmd==="/quizlist"){
    const r=await env.DB.prepare("SELECT id,title,status FROM quizzes ORDER BY id DESC LIMIT 20").all<{id:number;title:string;status:string}>();
    return say(env,chat,r.results.length?r.results.map(q=>`#${q.id} — ${esc(q.title)} [${q.status}]`).join("\n"):"Викторин пока нет.");
  }
  if(cmd==="/publish"){
    const id=Number(args[0]);
    if(!Number.isInteger(id)||id<1) return say(env,chat,"Формат: /publish ID");
    const q=await env.DB.prepare("SELECT id,title FROM quizzes WHERE id=? AND status='draft'").bind(id).first<{id:number;title:string}>();
    if(!q) return say(env,chat,"Черновик не найден или уже опубликован.");
    const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM questions WHERE quiz_id=?").bind(id).first<{n:number}>();
    if(!count?.n) return say(env,chat,"В черновике нет вопросов.");
    if(!env.CHANNEL_ID||!env.CHANNEL_USERNAME||!env.BOT_USERNAME) return say(env,chat,"Не настроены CHANNEL_ID, CHANNEL_USERNAME или BOT_USERNAME в Cloudflare.");
    const hours=Number(env.QUIZ_HOURS||48), end=new Date(Date.now()+hours*3600000).toISOString();
    const sent=await tg(env,"sendMessage",{chat_id:env.CHANNEL_ID,parse_mode:"HTML",text:`🎬 <b>${esc(q.title)}</b>\n\nНовая кино-викторина канала @${env.CHANNEL_USERNAME}!\nВнутри ${count.n} вопросов. На каждый — три попытки. Викторина доступна ${hours} часов.`,reply_markup:{inline_keyboard:[[{text:"🎬 Участвовать в викторине",url:`https://t.me/${env.BOT_USERNAME}?start=quiz_${id}`}]]}}) as {message_id:number};
    await env.DB.prepare("UPDATE quizzes SET status='published',published_at=?,ends_at=?,channel_message_id=? WHERE id=?").bind(isoNow(),end,sent.message_id,id).run();
    return say(env,chat,`Викторина #${id} опубликована в канале.`);
  }
  const d=await getDraft(env,uid);
  if(!d) return say(env,chat,"Команды администратора: /newquiz, /quizlist, /publish ID, /cancel.");
  if(d.stage==="title"){if(!text)return say(env,chat,"Название не должно быть пустым.");d.title=text;d.stage="prompt";}
  else if(d.stage==="prompt"){if(!text)return say(env,chat,"Вопрос не должен быть пустым.");d.prompt=text;d.stage="answer";}
  else if(d.stage==="answer"){if(!text)return say(env,chat,"Ответ не должен быть пустым.");d.answer=text;d.stage="aliases";}
  else if(d.stage==="aliases"){d.questions.push({prompt:d.prompt!,answer:d.answer!,aliases:text==="—"?[]:text.split(";").map(x=>x.trim()).filter(Boolean)});d.stage="more";}
  else if(d.stage==="more"){
    if(text==="+"){d.stage="prompt";}
    else if(["готово","готово!","done"].includes(text.toLowerCase())){
      if(!d.questions.length)return say(env,chat,"Добавь хотя бы один вопрос.");
      const id=await saveQuiz(env,uid,d);return say(env,chat,`Черновик #${id} «${esc(d.title||"")}» сохранён. Публикация: /publish ${id}`);
    } else return say(env,chat,"Отправь «+» для следующего вопроса или «готово» для сохранения.");
  }
  await putDraft(env,uid,d);
  const prompts:Record<string,string>={prompt:"Отправь текст вопроса.",answer:"Укажи правильный ответ — название фильма.",aliases:"Укажи альтернативные варианты через ; или отправь —",more:`Вопросов добавлено: ${d.questions.length}. Отправь «+» для следующего вопроса или «готово» для сохранения.`};
  return say(env,chat,d.stage==="title"?"Отправь название викторины.":prompts[d.stage]||"Продолжим.");
}
async function sendQuestion(env:Env,chat:number,userId:number,quizId:number){
  const s=await env.DB.prepare("SELECT * FROM sessions WHERE user_id=? AND quiz_id=?").bind(userId,quizId).first<any>();
  if(!s||s.completed)return;
  const q=await env.DB.prepare("SELECT id,prompt FROM questions WHERE quiz_id=? ORDER BY position LIMIT 1 OFFSET ?").bind(quizId,s.question_pos).first<{id:number;prompt:string}>();
  const total=await env.DB.prepare("SELECT COUNT(*) AS n FROM questions WHERE quiz_id=?").bind(quizId).first<{n:number}>();
  if(!q){
    await env.DB.prepare("UPDATE sessions SET completed=1 WHERE id=?").bind(s.id).run();
    return say(env,chat,`🎉 Викторина завершена! Твой результат: ${s.score} баллов.\n/leaderboard — общий рейтинг.`);
  }
  return say(env,chat,`🎬 <b>Вопрос ${s.question_pos+1} из ${total?.n||0}</b>\n${esc(q.prompt)}\n\nУ тебя 3 попытки. Напиши название фильма.`);
}
async function beginQuiz(env:Env,m:TgMessage,quizId:number){
  const uid=m.from!.id,chat=m.chat.id;
  const quiz=await env.DB.prepare("SELECT * FROM quizzes WHERE id=? AND status='published'").bind(quizId).first<any>();
  if(!quiz)return say(env,chat,"Эта викторина не найдена или ещё не опубликована.");
  if(!quiz.ends_at||Date.parse(quiz.ends_at)<=Date.now())return say(env,chat,"Время этой викторины уже закончилось.");
  let s=await env.DB.prepare("SELECT * FROM sessions WHERE user_id=? AND quiz_id=?").bind(uid,quizId).first<any>();
  if(s?.completed)return say(env,chat,`Ты уже завершил эту викторину. Результат: ${s.score} баллов.`);
  const expiry=new Date(Date.now()+Number(env.SESSION_MINUTES||20)*60000).toISOString();
  if(!s){
    await env.DB.prepare("INSERT INTO sessions(user_id,quiz_id,question_pos,attempts,score,started_at,expires_at,completed) VALUES(?,?,0,0,0,?,?,0)").bind(uid,quizId,isoNow(),expiry).run();
  }else{
    await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE id=?").bind(expiry,s.id).run();
  }
  return sendQuestion(env,chat,uid,quizId);
}
async function participantMessage(env:Env,m:TgMessage){
  const uid=m.from!.id,chat=m.chat.id,text=(m.text||"").trim();
  if(text.startsWith("/start")){
    const payload=text.split(/\s+/,2)[1]||"";
    const match=payload.match(/^quiz_(\d+)$/);
    if(match)return beginQuiz(env,m,Number(match[1]));
    return say(env,chat,"Привет! Я бот закрытых кино-викторин канала @ilovemoovie. Открой кнопку под постом с викториной, чтобы начать игру.\n\n/leaderboard — рейтинг\n/privacy — скрыть имя в рейтинге.");
  }
  if(text==="/privacy"){
    const u=await env.DB.prepare("SELECT private FROM users WHERE id=?").bind(uid).first<{private:number}>();
    if(!u)return say(env,chat,"Сначала отправь /start.");
    const next=u.private?0:1;
    await env.DB.prepare("UPDATE users SET private=? WHERE id=?").bind(next,uid).run();
    return say(env,chat,next?"Твоё имя скрыто в рейтинге.":"Твоё имя снова отображается в рейтинге.");
  }
  if(text==="/leaderboard"){
    const r=await env.DB.prepare("SELECT u.full_name,SUM(s.score) score FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.completed=1 AND u.private=0 GROUP BY u.id ORDER BY score DESC,u.full_name LIMIT 20").all<{full_name:string;score:number}>();
    if(!r.results.length)return say(env,chat,"Рейтинг пока пуст. Стань первым участником!");
    return say(env,chat,"🏆 <b>Рейтинг @ilovemoovie</b>\n"+r.results.map((x,i)=>`${i+1}. ${esc(x.full_name)} — ${x.score} баллов`).join("\n"));
  }
  if(!text||text.startsWith("/"))return;
  const s=await env.DB.prepare("SELECT s.*,q.id AS question_id,q.answer FROM sessions s JOIN questions q ON q.quiz_id=s.quiz_id AND q.position=s.question_pos WHERE s.user_id=? AND s.completed=0 ORDER BY s.started_at DESC LIMIT 1").bind(uid).first<any>();
  if(!s)return;
  if(Date.parse(s.expires_at)<=Date.now()){
    return say(env,chat,"Время игровой сессии истекло. Твой прогресс сохранён. Открой кнопку участия в посте викторины, чтобы продолжить.");
  }
  const aliases=await env.DB.prepare("SELECT alias FROM aliases WHERE question_id=?").bind(s.question_id).all<{alias:string}>();
  const accepted=[s.answer,...aliases.results.map(x=>x.alias)];
  const attempt=s.attempts+1,correct=accepted.some(x=>norm(x)===norm(text));
  await env.DB.prepare("INSERT INTO answers(session_id,question_id,attempt,answer,correct,created_at) VALUES(?,?,?,?,?,?)").bind(s.id,s.question_id,attempt,text,correct?1:0,isoNow()).run();
  if(correct){
    const score=s.score+POINTS[attempt];
    await env.DB.prepare("UPDATE sessions SET score=?,question_pos=question_pos+1,attempts=0 WHERE id=?").bind(score,s.id).run();
    await say(env,chat,`✅ Верно! +${POINTS[attempt]} баллов. Всего: ${score}.`);
    return sendQuestion(env,chat,uid,s.quiz_id);
  }
  if(attempt>=3){
    await env.DB.prepare("UPDATE sessions SET question_pos=question_pos+1,attempts=0 WHERE id=?").bind(s.id).run();
    await say(env,chat,`❌ Попытки закончились. Правильный ответ: <b>${esc(s.answer)}</b>.`);
    return sendQuestion(env,chat,uid,s.quiz_id);
  }
  await env.DB.prepare("UPDATE sessions SET attempts=? WHERE id=?").bind(attempt,s.id).run();
  return say(env,chat,`❌ Не угадал. Осталось попыток: ${3-attempt}. Попробуй ещё раз.`);
}
async function handleUpdate(env:Env,u:Update){
  const m=u.message;
  if(!m?.from||!m.text||m.chat.type!=="private")return;
  await userUpsert(env,m.from);
  if(admin(env,m.from.id))return adminMessage(env,m);
  return participantMessage(env,m);
}
export default {
  async fetch(request:Request,env:Env):Promise<Response>{
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/")return new Response("ilovemoovie quiz bot is running",{status:200});
    if(request.method!=="POST"||url.pathname!=="/telegram/webhook")return new Response("Not found",{status:404});
    if(!env.BOT_TOKEN||!env.WEBHOOK_SECRET||!env.DB)return new Response("Worker is not configured",{status:503});
    if(request.headers.get("X-Telegram-Bot-Api-Secret-Token")!==env.WEBHOOK_SECRET)return new Response("Forbidden",{status:403});
    try{
      const update=await request.json() as Update;
      if(update.update_id!==undefined){
        const seen=await env.DB.prepare("SELECT update_id FROM processed_updates WHERE update_id=?").bind(update.update_id).first();
        if(seen)return new Response("OK");
      }
      await handleUpdate(env,update);
      if(update.update_id!==undefined) await env.DB.prepare("INSERT OR IGNORE INTO processed_updates(update_id,processed_at) VALUES(?,?)").bind(update.update_id,isoNow()).run();
      return new Response("OK");
    }catch(e){
      console.error("Webhook error",e);
      return new Response("Internal error",{status:500});
    }
  }
};
