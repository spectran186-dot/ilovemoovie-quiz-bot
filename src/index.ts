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
  BOT_USERNAME: string;
  QUIZ_HOURS?: string;
  WEBHOOK_URL?: string;
}
type TgUser = { id:number; username?:string; first_name?:string; last_name?:string };
type TgMessage = { message_id:number; text?:string; caption?:string; photo?:Array<{file_id:string}>; video?:{file_id:string}; audio?:{file_id:string}; voice?:{file_id:string}; from?:TgUser; chat:{id:number;type:string} };
type TgCallback = { id:string; from:TgUser; data?:string; message?:TgMessage };
type Update = { update_id:number; message?:TgMessage; callback_query?:TgCallback };
type Draft = { stage:string; title?:string; mode?:"text"|"choice"; questions:Array<{prompt:string;answer:string;aliases:string[];options:string[];media_type?:string|null;media_file_id?:string|null}>; prompt?:string; answer?:string; options?:string[]; media_type?:string|null; media_file_id?:string|null };
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
async function editGame(env:Env,chat_id:number,message_id:number,text:string,reply_markup?:Record<string,unknown>){
  return tg(env,"editMessageText",{chat_id,message_id,text,parse_mode:"HTML",reply_markup:reply_markup||{inline_keyboard:[]}});
}
async function editOrSendGame(env:Env,chat:number,messageId:number|null|undefined,text:string,sessionId:number,reply_markup?:Record<string,unknown>){
  if(messageId){
    try { await editGame(env,chat,messageId,text,reply_markup); return; }
    catch(e){
      const reason=String(e);
      // Telegram returns 400 when the requested content is identical; this is not a gameplay failure.
      if(reason.includes("message is not modified")) return;
      console.error("Game message edit failed; sending replacement",reason);
    }
  }
  const sent=await say(env,chat,text,reply_markup?{reply_markup}:{}) as {message_id:number};
  await env.DB.prepare("UPDATE sessions SET game_message_id=? WHERE id=?").bind(sent.message_id,sessionId).run();
}
async function removeAnswer(env:Env,chat_id:number,message_id:number){ try { await tg(env,"deleteMessage",{chat_id,message_id}); } catch {} }
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
  const result=await env.DB.prepare("INSERT INTO quizzes(title,status,created_at,answer_mode) VALUES(?,'draft',?,?)").bind(d.title||"",isoNow(),d.mode||"text").run();
  const quizId=Number(result.meta.last_row_id);
  for(let i=0;i<d.questions.length;i++){
    const q=d.questions[i];
    const qr=await env.DB.prepare("INSERT INTO questions(quiz_id,position,prompt,answer,options,media_type,media_file_id) VALUES(?,?,?,?,?,?,?)").bind(quizId,i+1,q.prompt,q.answer,JSON.stringify(q.options||[]),q.media_type||null,q.media_file_id||null).run();
    const qid=Number(qr.meta.last_row_id);
    for(const a of q.aliases) await env.DB.prepare("INSERT INTO aliases(question_id,alias) VALUES(?,?)").bind(qid,a).run();
  }
  await putDraft(env,id,null);
  return quizId;
}
async function adminPanel(env:Env,chat:number){
 return say(env,chat,"🛠 <b>Административная панель</b>\nВыбери раздел:",{reply_markup:{inline_keyboard:[
 [{text:"➕ Создать квиз",callback_data:"adm:new"},{text:"📋 Список квизов",callback_data:"adm:list"}],
 [{text:"🏆 Рейтинги",callback_data:"adm:ratings"}],
 [{text:"⚙️ Управление квизами",callback_data:"adm:manage"}]
 ]}});
}
async function adminMessage(env:Env,m:TgMessage){
  const uid=m.from!.id, text=(m.text||m.caption||"").trim(), chat=m.chat.id;
  const [cmd,...args]=text.split(/\s+/);
  // Always route participant commands outside the admin draft wizard.
  if(cmd==="/start"||cmd==="/privacy"||cmd==="/leaderboard") return participantMessage(env,m);
  if(cmd==="/refreshwebhook"){
    if(!env.WEBHOOK_URL) return say(env,chat,"Не задан WEBHOOK_URL в настройках Worker.");
    try {
      const result=await tg(env,"setWebhook",{url:env.WEBHOOK_URL,secret_token:env.WEBHOOK_SECRET,allowed_updates:["message","callback_query"],max_connections:40});
      return say(env,chat,result===true?"Webhook обновлён: сообщения и нажатия кнопок принимаются.":"Telegram не подтвердил обновление webhook.");
    } catch(e) {
      console.error("setWebhook failed",e);
      return say(env,chat,"Не удалось обновить webhook: "+esc(String(e).slice(0,180)));
    }
  }
  if(cmd==="/admin") return adminPanel(env,chat);
  if(cmd==="/cancel"){await putDraft(env,uid,null);return say(env,chat,"Создание викторины отменено.");}
  if(cmd==="/newquiz"){await putDraft(env,uid,{stage:"title",questions:[]});return say(env,chat,"🎬 Отправь название викторины.",{reply_markup:{inline_keyboard:[[{text:"✖️ Отмена",callback_data:"wiz:cancel"}]]}});}
  if(cmd==="/quizlist"){
    const r=await env.DB.prepare("SELECT id,title,status FROM quizzes ORDER BY id DESC LIMIT 20").all<{id:number;title:string;status:string}>();
    return say(env,chat,r.results.length?r.results.map(q=>`#${q.id} — ${esc(q.title)} [${q.status}]`).join("\n"):"Викторин пока нет.");
  }
  if(cmd==="/delete"){
    const id=Number(args[0]);
    if(!Number.isInteger(id)||id<1) return say(env,chat,"Формат: /delete ID");
    const q=await env.DB.prepare("SELECT id,title FROM quizzes WHERE id=?").bind(id).first<{id:number;title:string}>();
    if(!q) return say(env,chat,"Викторина не найдена.");
    return say(env,chat,`Удалить викторину #${id} «${esc(q.title)}»? Будут удалены вопросы, ответы и результаты всех игроков. Это действие необратимо.`,{reply_markup:{inline_keyboard:[[{text:"🗑 Да, удалить",callback_data:"delconfirm:"+id},{text:"Отмена",callback_data:"delcancel"}]]}});
  }
  if(cmd==="/publish"){
    const id=Number(args[0]);
    if(!Number.isInteger(id)||id<1) return say(env,chat,"Формат: /publish ID");
    const q=await env.DB.prepare("SELECT id,title FROM quizzes WHERE id=? AND status IN ('draft','published')").bind(id).first<{id:number;title:string}>();
    if(!q) return say(env,chat,"Викторина не найдена или недоступна для публикации.");
    const count=await env.DB.prepare("SELECT COUNT(*) AS n FROM questions WHERE quiz_id=?").bind(id).first<{n:number}>();
    if(!count?.n) return say(env,chat,"В черновике нет вопросов.");
    if(!env.CHANNEL_ID||!env.BOT_USERNAME) return say(env,chat,"Не настроены CHANNEL_ID или BOT_USERNAME в Cloudflare.");
    const hours=Number(env.QUIZ_HOURS||48), end=new Date(Date.now()+hours*3600000).toISOString();
    const sent=await tg(env,"sendMessage",{chat_id:env.CHANNEL_ID,parse_mode:"HTML",text:`🎬 <b>${esc(q.title)}</b>\n\nНовая кино-викторина!\nВнутри ${count.n} вопросов. На каждый — три попытки. Викторина доступна ${hours} часов.`,reply_markup:{inline_keyboard:[[{text:"🎬 Участвовать в викторине",url:`https://t.me/${env.BOT_USERNAME}?start=quiz_${id}`}]]}}) as {message_id:number};
    // A republish starts a completely fresh round for every participant.
    // Keep the quiz/questions/answers, but remove all old sessions and scores.
    await env.DB.prepare("DELETE FROM sessions WHERE quiz_id=?").bind(id).run();
    await env.DB.prepare("UPDATE quizzes SET status='published',published_at=?,ends_at=?,channel_message_id=? WHERE id=?").bind(isoNow(),end,sent.message_id,id).run();
    return say(env,chat,`Викторина #${id} опубликована заново. Прогресс и результаты игроков сброшены — все могут начать сначала.`);
  }
  const d=await getDraft(env,uid);
  // Admins can also play: route ordinary text to an active quiz when no quiz draft is being edited.
  if(!d && !text.startsWith("/")) return participantMessage(env,m);
  if(!d) return say(env,chat,"Используй /admin для открытия панели администратора.");
  if(d.stage==="title"){if(!text)return say(env,chat,"Название не должно быть пустым.");d.title=text;d.stage="mode";}
  else if(d.stage==="mode"){if(text!=="1"&&text!=="2")return say(env,chat,"Выбери режим кнопкой ниже.");d.mode=text==="1"?"choice":"text";d.stage="prompt";}
  
  else if(d.stage==="prompt"){const media=m.photo?.length?{type:"photo",id:m.photo[m.photo.length-1].file_id}:m.video?{type:"video",id:m.video.file_id}:m.audio?{type:"audio",id:m.audio.file_id}:m.voice?{type:"voice",id:m.voice.file_id}:null;const prompt=text||m.caption||"";if(!prompt&&!media)return say(env,chat,"Отправь текст вопроса или фото, видео либо аудио с подписью.");d.prompt=prompt||" ";d.media_type=media?.type||null;d.media_file_id=media?.id||null;d.stage=d.mode==="choice"?"options":"answer";}
  else if(d.stage==="options"){const a=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(a.length<2||a.length>6)return say(env,chat,"Отправь 2–6 вариантов, каждый с новой строки.");d.options=a;d.stage="correct";}
  else if(d.stage==="correct"){const n=Number(text);if(!Number.isInteger(n)||n<1||n>(d.options||[]).length)return say(env,chat,"Отправь номер правильного варианта.");d.answer=d.options![n-1];d.stage="aliases";}
  else if(d.stage==="answer"){if(!text)return say(env,chat,"Ответ не должен быть пустым.");d.answer=text;d.options=[];d.stage="aliases";}
  else if(d.stage==="aliases"){d.questions.push({prompt:d.prompt!,answer:d.answer!,aliases:text==="—"?[]:text.split(";").map(x=>x.trim()).filter(Boolean),options:d.options||[],media_type:d.media_type||null,media_file_id:d.media_file_id||null});d.prompt=undefined;d.answer=undefined;d.options=undefined;d.media_type=null;d.media_file_id=null;d.stage="more";}
  else if(d.stage==="more"){
    if(text==="+"){d.stage="prompt";}
    else if(["готово","готово!","done"].includes(text.toLowerCase())){
      if(!d.questions.length)return say(env,chat,"Добавь хотя бы один вопрос.");
      const id=await saveQuiz(env,uid,d);return say(env,chat,`Черновик #${id} «${esc(d.title||"")}» сохранён. Публикация: /publish ${id}`);
    } else return say(env,chat,"Отправь «+» для следующего вопроса или «готово» для сохранения.");
  }
  await putDraft(env,uid,d);
  const prompts:Record<string,string>={mode:"Выбери режим ответа кнопкой.",prompt:"Отправь текст вопроса или фото/видео/аудио с подписью.",options:"Отправь 2–6 вариантов, каждый с новой строки.",correct:"Отправь номер правильного варианта.",answer:"Укажи правильный ответ.",aliases:"Укажи альтернативные варианты через ; или отправь —",more:`Вопросов добавлено: ${d.questions.length}. Отправь «+» для следующего вопроса или «готово» для сохранения.`};
  const kb:Record<string,any>={mode:{inline_keyboard:[[{text:"🔘 Варианты ответа",callback_data:"wiz:mode:choice"},{text:"✍️ Свой ответ",callback_data:"wiz:mode:text"}],[{text:"✖️ Отмена",callback_data:"wiz:cancel"}]]},more:{inline_keyboard:[[{text:"➕ Добавить вопрос",callback_data:"wiz:more"},{text:"💾 Сохранить квиз",callback_data:"wiz:save"}],[{text:"✖️ Отмена",callback_data:"wiz:cancel"}]]}};return say(env,chat,d.stage==="title"?"Отправь название викторины.":prompts[d.stage]||"Продолжим.",kb[d.stage]?{reply_markup:kb[d.stage]}:{});
}
async function sendQuestion(env:Env,chat:number,userId:number,quizId:number,feedback=""){
  const s=await env.DB.prepare("SELECT * FROM sessions WHERE user_id=? AND quiz_id=?").bind(userId,quizId).first<any>();
  if(!s||s.completed)return;
  const q=await env.DB.prepare("SELECT id,prompt,options,media_type,media_file_id FROM questions WHERE quiz_id=? ORDER BY position LIMIT 1 OFFSET ?").bind(quizId,s.question_pos).first<{id:number;prompt:string;options:string;media_type:string|null;media_file_id:string|null}>();
  const quiz=await env.DB.prepare("SELECT answer_mode FROM quizzes WHERE id=?").bind(quizId).first<{answer_mode:string}>();
  const total=await env.DB.prepare("SELECT COUNT(*) AS n FROM questions WHERE quiz_id=?").bind(quizId).first<{n:number}>();
  let body:string;
  if(!q){ await env.DB.prepare("UPDATE sessions SET completed=1 WHERE id=?").bind(s.id).run(); body="🎉 <b>Викторина завершена!</b>\nТвой результат: "+s.score+" баллов.\n/leaderboard — общий рейтинг."; }
  else {
    if(q.media_type&&q.media_file_id){const method=q.media_type==="photo"?"sendPhoto":q.media_type==="video"?"sendVideo":q.media_type==="voice"?"sendVoice":"sendAudio";const mediaKey=q.media_type==="photo"?"photo":q.media_type==="video"?"video":q.media_type==="voice"?"voice":"audio";await tg(env,method,{chat_id:chat,[mediaKey]:q.media_file_id});}
    body="🎬 <b>Вопрос "+(s.question_pos+1)+" из "+(total?.n||0)+"</b>\n"+esc(q.prompt)+"\n\nУ тебя 3 попытки.";
    if(quiz?.answer_mode==="choice"){
      const options=JSON.parse(q.options||"[]") as string[];
      body+="\nВыбери один вариант:";
      const reply_markup={inline_keyboard:options.map((v,i)=>[{text:v,callback_data:"a:"+quizId+":"+q.id+":"+i}])};
      await editOrSendGame(env,chat,s.game_message_id,body+(feedback?"\n\n"+feedback:""),s.id,reply_markup);
      return;
    }
    body+="\nНапиши свой ответ сообщением.";
  }
  await editOrSendGame(env,chat,s.game_message_id,body+(feedback?"\n\n"+feedback:""),s.id);
}
async function beginQuiz(env:Env,m:TgMessage,quizId:number){
  const uid=m.from!.id,chat=m.chat.id;
  const quiz=await env.DB.prepare("SELECT * FROM quizzes WHERE id=? AND status='published'").bind(quizId).first<any>();
  if(!quiz)return say(env,chat,"Эта викторина не найдена или ещё не опубликована.");
  if(!quiz.ends_at||Date.parse(quiz.ends_at)<=Date.now())return say(env,chat,"Время этой викторины уже закончилось.");
  let s=await env.DB.prepare("SELECT * FROM sessions WHERE user_id=? AND quiz_id=?").bind(uid,quizId).first<any>();
  if(s?.completed)return say(env,chat,`Ты уже завершил эту викторину. Результат: ${s.score} баллов.`);
  const expiry="2099-12-31T23:59:59.999Z";
  if(!s){
    await env.DB.prepare("INSERT INTO sessions(user_id,quiz_id,question_pos,attempts,score,started_at,expires_at,completed) VALUES(?,?,0,0,0,?,?,0)").bind(uid,quizId,isoNow(),expiry).run();
  }else{
    await env.DB.prepare("UPDATE sessions SET expires_at=? WHERE id=?").bind(expiry,s.id).run();
  }
  return sendQuestion(env,chat,uid,quizId);
}
async function participantMessage(env:Env,m:TgMessage){
  const uid=m.from!.id,chat=m.chat.id,text=(m.text||"").trim();
  if(text.startsWith("/start")){ const payload=text.split(/\s+/,2)[1]||""; const match=payload.match(/^quiz_(\d+)$/); if(match)return beginQuiz(env,m,Number(match[1])); return say(env,chat,"Привет! Открой кнопку под постом с викториной, чтобы начать игру.\n/leaderboard — рейтинг\n/privacy — скрыть имя в рейтинге."); }
  if(text==="/privacy"){ const u=await env.DB.prepare("SELECT private FROM users WHERE id=?").bind(uid).first<{private:number}>(); if(!u)return say(env,chat,"Сначала отправь /start."); const next=u.private?0:1; await env.DB.prepare("UPDATE users SET private=? WHERE id=?").bind(next,uid).run(); return say(env,chat,next?"Твоё имя скрыто в рейтинге.":"Твоё имя снова отображается в рейтинге."); }
  if(text==="/leaderboard"){ const r=await env.DB.prepare("SELECT u.full_name,SUM(s.score) score FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.completed=1 AND u.private=0 GROUP BY u.id ORDER BY score DESC,u.full_name LIMIT 20").all<{full_name:string;score:number}>(); if(!r.results.length)return say(env,chat,"Рейтинг пока пуст. Стань первым участником!"); return say(env,chat,"🏆 <b>Рейтинг кино-викторины</b>\n"+r.results.map((x,i)=>(i+1)+". "+esc(x.full_name)+" — "+x.score+" баллов").join("\n")); }
  if(!text||text.startsWith("/"))return;
  const s=await env.DB.prepare("SELECT s.*,q.id AS question_id,q.answer FROM sessions s JOIN questions q ON q.quiz_id=s.quiz_id AND q.position=s.question_pos+1 WHERE s.user_id=? AND s.completed=0 ORDER BY s.started_at DESC LIMIT 1").bind(uid).first<any>();
  if(!s)return;
  try { await tg(env,"deleteMessage",{chat_id:chat,message_id:m.message_id}); } catch {}
  const aliases=await env.DB.prepare("SELECT alias FROM aliases WHERE question_id=?").bind(s.question_id).all<{alias:string}>();
  const accepted=[s.answer,...aliases.results.map(x=>x.alias)]; const attempt=s.attempts+1,correct=accepted.some(x=>norm(x)===norm(text));
  if(correct){ const score=s.score+POINTS[attempt]; await env.DB.prepare("UPDATE sessions SET score=?,question_pos=question_pos+1,attempts=0 WHERE id=?").bind(score,s.id).run(); return sendQuestion(env,chat,uid,s.quiz_id,"✅ Верно! +"+POINTS[attempt]+" баллов. Всего: "+score+"."); }
  if(attempt>=3){ await env.DB.prepare("UPDATE sessions SET question_pos=question_pos+1,attempts=0 WHERE id=?").bind(s.id).run(); return sendQuestion(env,chat,uid,s.quiz_id,"❌ Попытки закончились. Правильный ответ: <b>"+esc(s.answer)+"</b>."); }
  await env.DB.prepare("UPDATE sessions SET attempts=? WHERE id=?").bind(attempt,s.id).run();
  return sendQuestion(env,chat,uid,s.quiz_id,"❌ Не угадал. Осталось попыток: "+(3-attempt)+".");
}
async function handleUpdate(env:Env,u:Update){
  if(u.callback_query){
    const c=u.callback_query, data=c.data||"";
    if(data.startsWith("wiz:")){if(!admin(env,c.from.id)){await tg(env,"answerCallbackQuery",{callback_query_id:c.id,text:"Нет доступа."});return;}const chat=c.message?.chat.id||c.from.id;const d=await getDraft(env,c.from.id);await tg(env,"answerCallbackQuery",{callback_query_id:c.id});if(data==="wiz:cancel"){await putDraft(env,c.from.id,null);return say(env,chat,"Создание квиза отменено.");}if(!d)return say(env,chat,"Черновик не найден. Начни заново через /admin.");if(data==="wiz:mode:choice"||data==="wiz:mode:text"){d.mode=data.endsWith("choice")?"choice":"text";d.stage="prompt";await putDraft(env,c.from.id,d);return say(env,chat,"Отправь вопрос текстом или фото/видео/аудио с подписью.");}if(data==="wiz:more"){d.stage="prompt";await putDraft(env,c.from.id,d);return say(env,chat,"Отправь следующий вопрос текстом или прикрепи медиа.");}if(data==="wiz:save"){if(!d.questions.length)return say(env,chat,"Добавь хотя бы один вопрос.");const id=await saveQuiz(env,c.from.id,d);return say(env,chat,`Черновик #${id} «${esc(d.title||"")}» сохранён. Опубликовать можно в «Управление квизами».`);}return;}
    if(data.startsWith("adm:")){
      if(!admin(env,c.from.id)){await tg(env,"answerCallbackQuery",{callback_query_id:c.id,text:"Нет доступа."});return;}
      const parts=data.split(":"), action=parts[1], id=Number(parts[2]), chat=c.message?.chat.id||c.from.id;
      await tg(env,"answerCallbackQuery",{callback_query_id:c.id});
      if(action==="home") return adminPanel(env,chat);
      if(action==="ratings") return say(env,chat,"🏆 <b>Рейтинги</b>\nВыбери нужный рейтинг:",{reply_markup:{inline_keyboard:[[{text:"🏆 Общий рейтинг",callback_data:"adm:overall"},{text:"📊 По викторинам",callback_data:"adm:perquiz"}],[{text:"↩️ В меню",callback_data:"adm:home"}]]}});
      if(action==="new"){await putDraft(env,c.from.id,{stage:"title",questions:[]});return say(env,chat,"Отправь название новой викторины.");}
      if(action==="list") return adminMessage(env,{message_id:0,text:"/quizlist",from:c.from,chat:{id:chat,type:"private"}});
      if(action==="overall"||action==="perquiz"){
        const sql=action==="overall"?"SELECT u.full_name,SUM(s.score) score FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.completed=1 AND u.private=0 GROUP BY u.id ORDER BY score DESC LIMIT 20":"SELECT q.id,q.title,u.full_name,s.score,s.completed FROM quizzes q LEFT JOIN sessions s ON s.quiz_id=q.id LEFT JOIN users u ON u.id=s.user_id AND u.private=0 ORDER BY q.id DESC,s.score DESC";
        const r=await env.DB.prepare(sql).all<any>();
        const grouped=new Map<number,{title:string;players:any[]}>();if(action==="perquiz")for(const x of r.results){if(!grouped.has(x.id))grouped.set(x.id,{title:x.title,players:[]});if(x.full_name)grouped.get(x.id)!.players.push(x);}const out=action==="overall"?r.results.map((x:any,i:number)=>(i+1)+". "+esc(x.full_name)+" — "+x.score).join("\n"):Array.from(grouped.values()).map(g=>"<b>"+esc(g.title)+"</b>\n"+(g.players.length?g.players.map((p:any,i:number)=>(i+1)+". "+esc(p.full_name)+" — "+p.score+" баллов"+(p.completed?" ✓":" (в процессе)")).join("\n"):"Участников пока нет")).join("\n\n");
        return say(env,chat,(action==="overall"?"🏆 <b>Общий рейтинг</b>":"📊 <b>Рейтинг по викторинам</b>")+"\n"+(out||"Данных пока нет."),{reply_markup:{inline_keyboard:[[{text:"↩️ В меню",callback_data:"adm:home"}]]}});
      }
      if(action==="manage"){
        const r=await env.DB.prepare("SELECT id,title,status FROM quizzes ORDER BY id DESC LIMIT 20").all<{id:number;title:string;status:string}>();
        const rows=r.results.map(q=>[{text:"#"+q.id+" "+q.title.slice(0,28),callback_data:"adm:item:"+q.id}]);
        rows.push([{text:"↩️ В меню",callback_data:"adm:home"}]);
        return say(env,chat,"⚙️ <b>Управление викторинами</b>\nВыбери викторину:",{reply_markup:{inline_keyboard:rows}});
      }
      if(action==="item"){
        const q=await env.DB.prepare("SELECT id,title,status FROM quizzes WHERE id=?").bind(id).first<{id:number;title:string;status:string}>();
        if(!q)return say(env,chat,"Викторина не найдена.",{reply_markup:{inline_keyboard:[[{text:"↩️ К списку",callback_data:"adm:manage"}]]}});
        const actions=[[{text:q.status==="draft"?"📢 Опубликовать":"🔄 Переопубликовать",callback_data:"adm:do_publish:"+id}]];
        actions.push([{text:"🗑 Удалить",callback_data:"adm:do_delete:"+id}]);
        actions.push([{text:"↩️ К списку",callback_data:"adm:manage"}]);
        return say(env,chat,"<b>Викторина #"+q.id+"</b>\n"+esc(q.title)+"\nСтатус: "+q.status,{reply_markup:{inline_keyboard:actions}});
      }
      if(action==="do_publish") return adminMessage(env,{message_id:0,text:"/publish "+id,from:c.from,chat:{id:chat,type:"private"}});
      if(action==="do_delete") return adminMessage(env,{message_id:0,text:"/delete "+id,from:c.from,chat:{id:chat,type:"private"}});
    }
    if(data==="delcancel"){
      if(!admin(env,c.from.id)){await tg(env,"answerCallbackQuery",{callback_query_id:c.id,text:"Нет доступа."});return;}
      await tg(env,"answerCallbackQuery",{callback_query_id:c.id,text:"Удаление отменено."});
      if(c.message) return tg(env,"editMessageText",{chat_id:c.message.chat.id,message_id:c.message.message_id,text:"Удаление викторины отменено."});
      return;
    }
    const del=data.match(/^delconfirm:(\d+)$/);
    if(del){
      if(!admin(env,c.from.id)){await tg(env,"answerCallbackQuery",{callback_query_id:c.id,text:"Нет доступа."});return;}
      const id=Number(del[1]);
      const q=await env.DB.prepare("SELECT id,title,channel_message_id FROM quizzes WHERE id=?").bind(id).first<{id:number;title:string;channel_message_id:number|null}>();
      if(!q){await tg(env,"answerCallbackQuery",{callback_query_id:c.id,text:"Викторина уже удалена."});return;}
      await env.DB.prepare("DELETE FROM answers WHERE session_id IN (SELECT id FROM sessions WHERE quiz_id=?)").bind(id).run();
      await env.DB.prepare("DELETE FROM sessions WHERE quiz_id=?").bind(id).run();
      await env.DB.prepare("DELETE FROM questions WHERE quiz_id=?").bind(id).run();
      await env.DB.prepare("DELETE FROM quizzes WHERE id=?").bind(id).run();
      if(q.channel_message_id&&env.CHANNEL_ID){try{await tg(env,"deleteMessage",{chat_id:env.CHANNEL_ID,message_id:q.channel_message_id});}catch(e){console.error("Could not remove quiz post",e);}}
      await tg(env,"answerCallbackQuery",{callback_query_id:c.id,text:"Викторина удалена."});
      if(c.message) return tg(env,"editMessageText",{chat_id:c.message.chat.id,message_id:c.message.message_id,text:`🗑 Викторина #${id} «${esc(q.title)}» удалена вместе с игровыми данными.`});
      return;
    }
    const match=data.match(/^a:(\d+):(\d+):(\d+)$/);
    if(!match||!c.message||c.message.chat.type!=="private") { await tg(env,"answerCallbackQuery",{callback_query_id:c.id,text:"Кнопка устарела. Открой викторину заново."}); return; }
    const quizId=Number(match[1]), questionId=Number(match[2]), index=Number(match[3]);
    const session=await env.DB.prepare("SELECT question_pos,quiz_id,completed FROM sessions WHERE user_id=? AND quiz_id=?").bind(c.from.id,quizId).first<any>();
    const current=await env.DB.prepare("SELECT id,options FROM questions WHERE quiz_id=? ORDER BY position LIMIT 1 OFFSET ?").bind(quizId,session?.question_pos||0).first<any>();
    if(!session||session.completed||!current||questionId!==current.id){
      await tg(env,"answerCallbackQuery",{callback_query_id:c.id,text:"Этот вопрос уже завершён."}); return;
    }
    const options=JSON.parse(current.options||"[]") as string[], chosen=options[index];
    if(!chosen){await tg(env,"answerCallbackQuery",{callback_query_id:c.id,text:"Вариант не найден."});return;}
    await tg(env,"answerCallbackQuery",{callback_query_id:c.id});
    await userUpsert(env,c.from);
    const fake:TgMessage={message_id:0,text:chosen,from:c.from,chat:c.message.chat};
    return participantMessage(env,fake);
  }
  const m=u.message;
  if(!m?.from||m.chat.type!=="private")return;
  await userUpsert(env,m.from);
  if(admin(env,m.from.id)){const draft=await getDraft(env,m.from.id);if(draft?.stage==="prompt"&&(m.photo||m.video||m.audio||m.voice||m.caption))return adminMessage(env,m);if(!m.text)return;return adminMessage(env,m);}
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
