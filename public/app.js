const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  try { tg.setHeaderColor("#080a0f"); tg.setBackgroundColor("#080a0f"); } catch {}
}

const state = {
  user: null, inventory: [], nfts: [], screen: "home",
  mine: {size:3, minesCount:2, bet:10, gameId:null},
  sourceId: null, targetKey: null, upgradeGame: null
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function headers() {
  return {
    "Content-Type":"application/json",
    "X-Telegram-Init-Data": tg?.initData || ""
  };
}
async function api(url, options={}) {
  const r = await fetch(url, {...options, headers:{...headers(), ...(options.headers||{})}});
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "Ошибка");
  return data;
}
function toast(text) {
  const el = $("#toast"); el.textContent=text; el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"),1800);
}
function setBalance(v) { $("#balance").textContent = Number(v).toLocaleString("ru-RU"); }

function art(n) {
  return `<div class="nft-art ${n.image||n.key?.replace("gift_","")||""}"></div>`;
}
function nftCard(n, selectable=false, selected=false, click="") {
  return `<button class="nft ${selected?"selected":""}" ${click?`onclick="${click}"`:""}>
    ${art(n)}
    <div class="nft-name">${n.nft_name || n.name}</div>
    <div class="nft-rarity">${n.rarity}</div>
    <div class="nft-value">${n.value} Stars</div>
  </button>`;
}
function renderInventory() {
  const html = state.inventory.length
    ? state.inventory.map(n=>nftCard(n)).join("")
    : `<div class="status">Инвентарь пуст</div>`;
  $("#homeInventory").innerHTML=html;
  $("#fullInventory").innerHTML=html;
}
function renderUpgrade() {
  $("#upgradeInventory").innerHTML = state.inventory.length
    ? state.inventory.map(n=>nftCard(n,true,state.sourceId===n.id,`selectSource(${n.id})`)).join("")
    : `<div class="status">Нет NFT для апгрейда</div>`;
  $("#targets").innerHTML = state.nfts.map(n=>nftCard(n,true,state.targetKey===n.key,`selectTarget('${n.key}')`)).join("");
  const source=state.inventory.find(x=>x.id===state.sourceId);
  const target=state.nfts.find(x=>x.key===state.targetKey);
  $("#sourceCard").innerHTML=source ? `${art(source)}<div class="nft-name">${source.nft_name}</div><div class="nft-rarity">${source.rarity}</div>` : "Выбери подарок";
  $("#sourceCard").classList.toggle("empty",!source);
  $("#targetCard").innerHTML=target ? `${art(target)}<div class="nft-name">${target.name}</div><div class="nft-rarity">${target.rarity}</div>` : "Выбери подарок";
  $("#targetCard").classList.toggle("empty",!target);
  if(source && target){
    const chance=chanceFor(source.value,target.value);
    $("#chance").textContent=chance.toFixed(1)+"%";
    $("#wheelSector").style.background=`conic-gradient(var(--green) 0deg,var(--green) ${chance*3.6}deg,rgba(255,255,255,.055) ${chance*3.6}deg,rgba(255,255,255,.055) 360deg)`;
  } else {
    $("#chance").textContent="—";
    $("#wheelSector").style.background="conic-gradient(#273044 0deg,#273044 360deg)";
  }
  $("#startUpgrade").disabled=!(source&&target);
}
function chanceFor(a,b){
  if(b<=a) return Math.min(95,75+(a-b)/Math.max(1,a)*20);
  return Math.max(2,Math.min(90,a/b*90));
}

window.selectSource=(id)=>{state.sourceId=id;renderUpgrade()};
window.selectTarget=(key)=>{state.targetKey=key;renderUpgrade()};

function go(screen) {
  state.screen=screen;
  $$(".screen").forEach(x=>x.classList.toggle("active",x.id===screen));
  $$(".nav-item").forEach(x=>x.classList.toggle("active",x.dataset.screen===screen));
  if(screen==="upgrade") renderUpgrade();
}
$$("[data-screen]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.screen)));

$("#boardSizes").addEventListener("click",e=>{
  if(!e.target.dataset.size)return;
  state.mine.size=Number(e.target.dataset.size);
  $$("#boardSizes button").forEach(x=>x.classList.toggle("selected",x===e.target));
  const max=state.mine.size*state.mine.size-1;
  $("#mineCount").max=Math.min(max, state.mine.size===3?7:state.mine.size===5?20:40);
  if(Number($("#mineCount").value)>Number($("#mineCount").max))$("#mineCount").value=$("#mineCount").max;
  $("#mineCountValue").textContent=$("#mineCount").value;
});
$("#mineCount").addEventListener("input",e=>{state.mine.minesCount=Number(e.target.value);$("#mineCountValue").textContent=e.target.value});
$("#bets").addEventListener("click",e=>{
  if(!e.target.dataset.bet)return;
  state.mine.bet=Number(e.target.dataset.bet);
  $$("#bets button").forEach(x=>x.classList.toggle("selected",x===e.target));
});

$("#startMines").onclick=async()=>{
  try{
    const data=await api("/api/mines/start",{method:"POST",body:JSON.stringify({
      size:state.mine.size,minesCount:Number($("#mineCount").value),bet:state.mine.bet
    })});
    state.mine.gameId=data.gameId; setBalance(data.balance);
    renderMineBoard();
    $("#mineStatus").textContent="Выбирай клетки";
    toast("Игра началась");
  }catch(e){toast(e.message)}
};

function renderMineBoard(opened=[]){
  const size=state.mine.size;
  const board=$("#mineBoard"); board.style.gridTemplateColumns=`repeat(${size},1fr)`;
  board.innerHTML=Array.from({length:size*size},(_,i)=>
    `<button class="mine-cell" data-cell="${i}"></button>`).join("");
  board.onclick=async e=>{
    if(!e.target.dataset.cell || !state.mine.gameId)return;
    try{
      const d=await api("/api/mines/cell",{method:"POST",body:JSON.stringify({gameId:state.mine.gameId,cell:Number(e.target.dataset.cell)})});
      setBalance(d.balance);
      d.opened.forEach(i=>{
        const c=board.querySelector(`[data-cell="${i}"]`);
        if(c)c.classList.add(d.mines?.includes(i)?"mine":"safe");
      });
      const c=board.querySelector(`[data-cell="${d.cell}"]`);
      if(c)c.classList.add(d.mine?"mine":"safe");
      if(d.mine){
        d.mines.forEach(i=>board.querySelector(`[data-cell="${i}"]`)?.classList.add("mine"));
        $("#mineStatus").textContent="Мина. Раунд завершен";
        state.mine.gameId=null;
      }else{
        $("#mineStatus").textContent=`+${d.reward} Stars`;
      }
    }catch(e){toast(e.message)}
  };
}

$("#startUpgrade").onclick=async()=>{
  if(!state.sourceId||!state.targetKey)return;
  const btn=$("#startUpgrade");btn.disabled=true;
  try{
    const d=await api("/api/upgrade/start",{method:"POST",body:JSON.stringify({
      sourceInventoryId:state.sourceId,targetKey:state.targetKey
    })});
    state.upgradeGame=d;
    const deg=Math.random()*360;
    const targetDeg=d.result==="success" ? Math.random()*d.chance*3.6 : d.chance*3.6+Math.random()*(360-d.chance*3.6);
    const finalDeg=360*5+targetDeg;
    $("#needle").style.transition="transform 3.6s cubic-bezier(.12,.72,.12,1)";
    $("#needle").style.transform=`rotate(${finalDeg}deg)`;
    $("#upgradeResult").textContent="Идет вращение...";
    setTimeout(async()=>{
      const fin=await api("/api/upgrade/finish",{method:"POST",body:JSON.stringify({gameId:d.gameId})});
      state.inventory=fin.inventory;
      state.sourceId=null; state.targetKey=null;
      renderInventory();renderUpgrade();
      $("#upgradeResult").textContent=fin.result==="success" ? `Апгрейд успешен: ${fin.target.name}` : "Неудача: NFT сгорел";
      toast(fin.result==="success"?"NFT получен":"Апгрейд неудачный");
      btn.disabled=false;
    },3900);
  }catch(e){toast(e.message);btn.disabled=false}
};

async function boot(){
  try{
    if (!tg?.initData) {
      throw new Error("Открой Mini App внутри Telegram");
    }
    const d=await api("/api/me");
    state.user=d.user;state.inventory=d.inventory;state.nfts=d.nfts;
    setBalance(d.user.balance);renderInventory();renderUpgrade();
    if (!document.querySelector("#topupBtn")) {
      const b=document.createElement("button");
      b.id="topupBtn"; b.className="primary"; b.textContent="Пополнить Stars";
      b.onclick=async()=>{
        const value=prompt("Сколько Stars пополнить?", "100");
        if(!value)return;
        try {
          const r=await api("/api/stars/invoice",{method:"POST",body:JSON.stringify({stars:Number(value)})});
          if(tg?.openInvoice) tg.openInvoice(r.url,()=>boot());
          else window.open(r.url,"_blank");
        } catch(e){toast(e.message)}
      };
      $("#home").insertBefore(b,$("#homeInventory"));
    }
    if(tg?.initDataUnsafe?.user){
      // UI uses Telegram identity; production server must validate initData before trusting it.
    }
  }catch(e){toast(e.message)}
}
boot();
