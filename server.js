const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const WEBAPP_URL = process.env.WEBAPP_URL || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "change-me";

const db = new DatabaseSync(path.join(__dirname, "data", "finder.db"), { timeout: 5000 });
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  nft_key TEXT NOT NULL,
  nft_name TEXT NOT NULL,
  rarity TEXT NOT NULL,
  value INTEGER NOT NULL,
  image TEXT,
  telegram_gift_id TEXT,
  status TEXT NOT NULL DEFAULT 'internal',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS mines_games (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  size INTEGER NOT NULL,
  mines_count INTEGER NOT NULL,
  bet INTEGER NOT NULL,
  mines TEXT NOT NULL,
  opened TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS upgrade_games (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  source_inventory_id INTEGER NOT NULL,
  target_key TEXT NOT NULL,
  target_name TEXT NOT NULL,
  target_rarity TEXT NOT NULL,
  target_value INTEGER NOT NULL,
  chance REAL NOT NULL,
  roll REAL NOT NULL,
  result TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  payload TEXT NOT NULL UNIQUE,
  stars INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  telegram_charge_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  result TEXT NOT NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const NFTS = [
  { key:"gift_star", name:"Star Gift", rarity:"Common", value:40, image:"star" },
  { key:"gift_rose", name:"Rose Gift", rarity:"Rare", value:80, image:"rose" },
  { key:"gift_crystal", name:"Crystal Gift", rarity:"Epic", value:160, image:"crystal" },
  { key:"gift_comet", name:"Comet Gift", rarity:"Legendary", value:300, image:"comet" },
  { key:"gift_crown", name:"Crown Gift", rarity:"Mythic", value:600, image:"crown" }
];

function id() { return crypto.randomBytes(12).toString("hex"); }

function validateTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const pairs = [...params.entries()].sort(([a],[b]) => a.localeCompare(b))
    .map(([k,v]) => `${k}=${v}`);
  const dataCheckString = pairs.join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))) return null;

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.floor(Date.now()/1000) - authDate > 86400) return null;

  let user = null;
  try { user = JSON.parse(params.get("user") || "null"); } catch {}
  return user;
}

function currentUser(req) {
  const telegramUser = validateTelegramInitData(req.headers["x-telegram-init-data"] || "");
  if (!telegramUser) return null;
  let u = db.prepare("SELECT * FROM users WHERE id=?").get(telegramUser.id);
  if (!u) {
    db.prepare("INSERT INTO users(id,username,first_name,balance) VALUES(?,?,?,0)")
      .run(telegramUser.id, telegramUser.username || "", telegramUser.first_name || "");
    u = db.prepare("SELECT * FROM users WHERE id=?").get(telegramUser.id);
  } else {
    db.prepare("UPDATE users SET username=?,first_name=? WHERE id=?")
      .run(telegramUser.username || "", telegramUser.first_name || "", telegramUser.id);
    u = db.prepare("SELECT * FROM users WHERE id=?").get(telegramUser.id);
  }
  return u;
}

function requireUser(req,res) {
  const u = currentUser(req);
  if (!u) { res.status(401).json({error:"Telegram authorization required"}); return null; }
  return u;
}

function publicUser(u) {
  return {id:u.id, username:u.username, firstName:u.first_name, balance:u.balance};
}
function inv(uid) {
  return db.prepare("SELECT * FROM inventory WHERE user_id=? ORDER BY id DESC").all(uid);
}
function chanceFor(a,b) {
  if (b <= a) return Math.min(95, 75 + (a-b)/Math.max(1,a)*20);
  return Math.max(2, Math.min(90, a/b*90));
}
function mines(size,count) {
  const s=new Set(), total=size*size;
  while(s.size<count) s.add(Math.floor(Math.random()*total));
  return [...s];
}

async function tg(method, body={}) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN is not configured");
  const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(body)
  });
  const d=await r.json();
  if (!d.ok) throw new Error(d.description || "Telegram API error");
  return d.result;
}

app.use(express.json({limit:"100kb"}));
app.use(express.static(path.join(__dirname,"public")));

app.get("/api/me",(req,res)=>{
  const u=requireUser(req,res); if(!u)return;
  res.json({user:publicUser(u),inventory:inv(u.id),nfts:NFTS});
});

app.get("/api/mines/config",(req,res)=>{
  res.json({boards:[
    {size:3,maxMines:7},{size:5,maxMines:20},{size:7,maxMines:40}
  ],bets:[5,10,25,50,100]});
});

app.post("/api/mines/start",(req,res)=>{
  const u=requireUser(req,res); if(!u)return;
  const size=Number(req.body.size), mc=Number(req.body.minesCount), bet=Number(req.body.bet);
  if(![3,5,7].includes(size)||!Number.isInteger(mc)||mc<1||mc>=size*size||
     ![5,10,25,50,100].includes(bet)) return res.status(400).json({error:"Некорректные параметры"});
  if(u.balance<bet)return res.status(400).json({error:"Недостаточно Stars"});
  const game=id(), ms=mines(size,mc);
  db.prepare("UPDATE users SET balance=balance-? WHERE id=?").run(bet,u.id);
  db.prepare("INSERT INTO mines_games(id,user_id,size,mines_count,bet,mines) VALUES(?,?,?,?,?,?)")
    .run(game,u.id,size,mc,bet,JSON.stringify(ms));
  const fresh=db.prepare("SELECT balance FROM users WHERE id=?").get(u.id);
  res.json({gameId:game,size,minesCount:mc,bet,balance:fresh.balance});
});

app.post("/api/mines/cell",(req,res)=>{
  const u=requireUser(req,res);if(!u)return;
  const g=db.prepare("SELECT * FROM mines_games WHERE id=? AND user_id=? AND active=1")
    .get(req.body.gameId,u.id);
  if(!g)return res.status(404).json({error:"Игра не найдена"});
  const cell=Number(req.body.cell),total=g.size*g.size;
  if(!Number.isInteger(cell)||cell<0||cell>=total)return res.status(400).json({error:"Клетка неверна"});
  const ms=JSON.parse(g.mines),opened=JSON.parse(g.opened);
  if(opened.includes(cell))return res.status(400).json({error:"Клетка уже открыта"});
  opened.push(cell);
  if(ms.includes(cell)){
    db.prepare("UPDATE mines_games SET opened=?,active=0 WHERE id=?").run(JSON.stringify(opened),g.id);
    db.prepare("INSERT INTO history(user_id,type,result,amount) VALUES(?,?,?,?)")
      .run(u.id,"mines","mine",-g.bet);
    const fresh=db.prepare("SELECT balance FROM users WHERE id=?").get(u.id);
    return res.json({mine:true,cell,mines:ms,opened,reward:0,balance:fresh.balance});
  }
  const reward=Math.max(1,Math.floor(g.bet*(1+(opened.length*(0.7+(g.mines_count/total)*2)))/(total-g.mines_count)*2.5));
  db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(reward,u.id);
  db.prepare("UPDATE mines_games SET opened=? WHERE id=?").run(JSON.stringify(opened),g.id);
  db.prepare("INSERT INTO history(user_id,type,result,amount) VALUES(?,?,?,?)")
    .run(u.id,"mines","safe",reward);
  const fresh=db.prepare("SELECT balance FROM users WHERE id=?").get(u.id);
  res.json({mine:false,cell,opened,reward,balance:fresh.balance});
});

app.get("/api/upgrades",(req,res)=>{
  const u=requireUser(req,res);if(!u)return;
  res.json({inventory:inv(u.id),targets:NFTS});
});

app.post("/api/upgrade/start",(req,res)=>{
  const u=requireUser(req,res);if(!u)return;
  const source=db.prepare("SELECT * FROM inventory WHERE id=? AND user_id=? AND status='internal'")
    .get(Number(req.body.sourceInventoryId),u.id);
  const target=NFTS.find(x=>x.key===String(req.body.targetKey||""));
  if(!source||!target)return res.status(400).json({error:"NFT не найден"});
  if(source.nft_key===target.key)return res.status(400).json({error:"Выберите другой NFT"});
  const chance=chanceFor(source.value,target.value),roll=Math.random()*100,result=roll<=chance?"success":"fail",game=id();
  db.exec("BEGIN IMMEDIATE");
  try {
    const removed=db.prepare("DELETE FROM inventory WHERE id=? AND user_id=? AND status='internal'").run(source.id,u.id);
    if(removed.changes!==1) throw new Error("NFT уже используется");
    db.prepare(`INSERT INTO upgrade_games
      (id,user_id,source_inventory_id,target_key,target_name,target_rarity,target_value,chance,roll,result,active)
      VALUES(?,?,?,?,?,?,?,?,?,?,1)`).run(game,u.id,source.id,target.key,target.name,target.rarity,target.value,chance,roll,result);
    db.exec("COMMIT");
  } catch(e) { db.exec("ROLLBACK"); return res.status(409).json({error:e.message}); }
  res.json({gameId:game,chance:Number(chance.toFixed(2)),result});
});

app.post("/api/upgrade/finish",(req,res)=>{
  const u=requireUser(req,res);if(!u)return;
  const g=db.prepare("SELECT * FROM upgrade_games WHERE id=? AND user_id=? AND active=1")
    .get(req.body.gameId,u.id);
  if(!g)return res.status(404).json({error:"Апгрейд не найден"});
  if(g.result==="success"){
    db.prepare(`INSERT INTO inventory(user_id,nft_key,nft_name,rarity,value,image,status)
      VALUES(?,?,?,?,?,?,?)`).run(u.id,g.target_key,g.target_name,g.target_rarity,g.target_value,
      g.target_key.replace("gift_",""),"internal");
  }
  db.prepare("UPDATE upgrade_games SET active=0 WHERE id=?").run(g.id);
  db.prepare("INSERT INTO history(user_id,type,result,amount) VALUES(?,?,?,?)")
    .run(u.id,"upgrade",g.result,g.result==="success"?g.target_value:0);
  res.json({result:g.result,target:g.result==="success"?{
    key:g.target_key,name:g.target_name,rarity:g.target_rarity,value:g.target_value
  }:null,inventory:inv(u.id)});
});

/* Real Telegram Stars top-up: creates a Stars invoice link.
   Telegram requires XTR and no provider token for digital goods. */
app.post("/api/stars/invoice",async(req,res)=>{
  const u=requireUser(req,res);if(!u)return;
  const stars=Math.floor(Number(req.body.stars));
  if(!Number.isInteger(stars)||stars<10||stars>10000)
    return res.status(400).json({error:"Сумма: 10–10000 Stars"});
  const payload=`topup:${u.id}:${crypto.randomUUID()}`;
  db.prepare("INSERT INTO payments(user_id,payload,stars) VALUES(?,?,?)").run(u.id,payload,stars);
  try {
    const link=await tg("createInvoiceLink",{
      title:"Finder Stars",
      description:`Пополнение игрового баланса на ${stars} Stars`,
      payload,
      currency:"XTR",
      prices:[{label:`${stars} Stars`,amount:stars}]
    });
    res.json({url:link,stars});
  } catch(e) {
    db.prepare("DELETE FROM payments WHERE payload=?").run(payload);
    res.status(502).json({error:e.message});
  }
});

/* Optional real Telegram gift delivery.
   It sends an actual Telegram gift from the bot's available gift stock.
   The internal NFT is not automatically marked delivered until Telegram confirms. */
app.post("/api/inventory/:id/claim",(req,res)=>{
  const u=requireUser(req,res);if(!u)return;
  const item=db.prepare("SELECT * FROM inventory WHERE id=? AND user_id=? AND status='internal'")
    .get(Number(req.params.id),u.id);
  if(!item)return res.status(404).json({error:"NFT не найден"});
  return res.status(409).json({
    error:"Для реальной выдачи нужен telegram_gift_id из доступного фонда бота. Добавь gift_id в админ-панели/БД после getAvailableGifts."
  });
});

/* Bot webhook. Put WEBHOOK_SECRET in Telegram webhook URL path. */
app.post(`/telegram/webhook/${WEBHOOK_SECRET}`,(req,res)=>{
  res.sendStatus(200);
  handleUpdate(req.body).catch(console.error);
});

async function handleUpdate(update) {
  if(update.pre_checkout_query){
    await tg("answerPreCheckoutQuery",{
      pre_checkout_query_id:update.pre_checkout_query.id,ok:true
    });
  }
  const p=update.message?.successful_payment;
  if(p){
    const payload=p.invoice_payload;
    const payment=db.prepare("SELECT * FROM payments WHERE payload=? AND status='pending'").get(payload);
    if(payment && payment.stars===p.total_amount){
      db.prepare("UPDATE users SET balance=balance+? WHERE id=?").run(payment.stars,payment.user_id);
      db.prepare("UPDATE payments SET status='paid',telegram_charge_id=? WHERE payload=?")
        .run(p.telegram_payment_charge_id,payload);
      db.prepare("INSERT INTO history(user_id,type,result,amount) VALUES(?,?,?,?)")
        .run(payment.user_id,"stars","topup",payment.stars);
    }
  }
  const m=update.message;
  if(m?.text==="/start" || m?.text?.startsWith("/start ")){
    if(BOT_TOKEN && WEBAPP_URL){
      await tg("sendMessage",{chat_id:m.chat.id,text:"Открой Finder Mini App:",reply_markup:{
        inline_keyboard:[[{text:"Открыть Finder",web_app:{url:WEBAPP_URL}}]]
      }});
    } else {
      await tg("sendMessage",{chat_id:m.chat.id,text:"Укажи WEBAPP_URL в .env"});
    }
  }
}

async function setupBot() {
  if(!BOT_TOKEN)return console.log("BOT_TOKEN не задан — сервер работает без Telegram bot API.");
  try{
    await tg("setMyCommands",{commands:[
      {command:"start",description:"Открыть Finder Mini App"}
    ]});
    if(WEBAPP_URL){
      await tg("setChatMenuButton",{menu_button:{type:"web_app",text:"Finder",web_app:{url:WEBAPP_URL}}});
      console.log("Telegram bot menu button configured.");
    }
    console.log("Telegram bot API connected.");
  }catch(e){console.error("Telegram setup:",e.message)}
}

app.get("/api/health",(req,res)=>res.json({
  ok:true,node:process.version,telegram:!!BOT_TOKEN,webapp:!!WEBAPP_URL
}));

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT,()=>{console.log(`Finder server: http://localhost:${PORT}`);setupBot();});
