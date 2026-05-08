const { Telegraf } = require("telegraf");
const fs = require("fs");

// ══════════════════════════════════════════════════════════
//  НАСТРОЙКИ
// ══════════════════════════════════════════════════════════
const BOT_TOKEN = process.env.BOT_TOKEN || "ВАШ_ТОКЕН_ЗДЕСЬ";
const DATA_FILE  = "data.json";
const MAX_WARNS  = 3;

const BAD_WORDS = [
  "бля","блять","блядь","сука","пизда","пиздец",
  "хуй","хуйня","ёбаный","ебать","еблан","залупа",
  "мразь","мудак","пидор","пидорас","ублюдок","шлюха",
  "проститутка","нахуй","нахер","ёб твою",
  "fuck","shit","bitch","asshole","bastard","cunt","dick",
];

const LEVELS = {
  0: { name:"👤 Пользователь", emoji:"👤", can_warn:false, can_mute:false, can_unmute:false, can_kick:false, can_ban:false, can_unban:false, can_promote:false, can_demote:false, max_promote:0 },
  1: { name:"🟢 Модератор",    emoji:"🟢", can_warn:true,  can_mute:true,  can_unmute:true,  can_kick:false, can_ban:false, can_unban:false, can_promote:false, can_demote:false, max_promote:0 },
  2: { name:"🔵 Старший мод",  emoji:"🔵", can_warn:true,  can_mute:true,  can_unmute:true,  can_kick:true,  can_ban:false, can_unban:false, can_promote:false, can_demote:false, max_promote:0 },
  3: { name:"🟣 Администратор",emoji:"🟣", can_warn:true,  can_mute:true,  can_unmute:true,  can_kick:true,  can_ban:false, can_unban:false, can_promote:true,  can_demote:true,  max_promote:2 },
  4: { name:"🔴 Главный админ",emoji:"🔴", can_warn:true,  can_mute:true,  can_unmute:true,  can_kick:true,  can_ban:true,  can_unban:true,  can_promote:true,  can_demote:true,  max_promote:3 },
  5: { name:"👑 Владелец",     emoji:"👑", can_warn:true,  can_mute:true,  can_unmute:true,  can_kick:true,  can_ban:true,  can_unban:true,  can_promote:true,  can_demote:true,  max_promote:4 },
};

// ══════════════════════════════════════════════════════════
//  ДАННЫЕ
// ══════════════════════════════════════════════════════════
function loadData() {
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE,"utf8"));
  return { warns:{}, admins:{}, banned:{} };
}
function saveData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d,null,2),"utf8"); }
function key(chatId, userId) { return `${chatId}:${userId}`; }
function getUserLevel(chatId, userId) { return loadData().admins[key(chatId,userId)] ?? 0; }
function setUserLevel(chatId, userId, level) {
  const d = loadData(); d.admins[key(chatId,userId)] = level; saveData(d);
}
function addWarn(chatId, userId, reason) {
  const d = loadData(); const k = key(chatId,userId);
  if (!d.warns[k]) d.warns[k] = [];
  d.warns[k].push({ reason, date: new Date().toISOString() });
  saveData(d); return d.warns[k].length;
}
function clearWarns(chatId, userId) {
  const d = loadData(); d.warns[key(chatId,userId)] = []; saveData(d);
}
function getWarns(chatId, userId) { return loadData().warns[key(chatId,userId)] ?? []; }

// ══════════════════════════════════════════════════════════
//  УТИЛИТЫ
// ══════════════════════════════════════════════════════════
function hasBadWord(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  return BAD_WORDS.some(w => t.includes(w));
}
function mention(user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return `<a href="tg://user?id=${user.id}">${esc(name)}</a>`;
}
function esc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}
function fmtTime(min) {
  if (min < 60) return `${min} мин.`;
  const h = Math.floor(min/60), m = min%60;
  return m ? `${h} ч. ${m} мин.` : `${h} ч.`;
}
async function isTgAdmin(ctx, userId) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return ["administrator","creator"].includes(m.status);
  } catch { return false; }
}
async function isTgCreator(ctx, userId) {
  try {
    const m = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return m.status === "creator";
  } catch { return false; }
}
async function canDo(ctx, userId, perm) {
  const lvl = getUserLevel(ctx.chat.id, userId);
  if (LEVELS[lvl]?.[perm]) return true;
  if (await isTgCreator(ctx, userId)) return true;
  return false;
}

// ══════════════════════════════════════════════════════════
//  БОТ
// ══════════════════════════════════════════════════════════
const bot = new Telegraf(BOT_TOKEN);

// Логируем все апдейты для отладки
bot.use((ctx, next) => {
  const chat = ctx.chat;
  const from = ctx.from;
  const text = ctx.message?.text ?? "";
  if (chat && from) {
    console.log(`[${chat.type}] chat=${chat.id} user=${from.id} "${text.slice(0,50)}"`);
  }
  return next();
});

// ── /start ────────────────────────────────────────────────
bot.command("start", async (ctx) => {
  await ctx.replyWithHTML(
    `👋 <b>Привет! Я бот-модератор.</b>\n\n`+
    `Добавь меня в группу, дай права администратора и пиши /help.`
  );
});

// ── /help ─────────────────────────────────────────────────
bot.command("help", async (ctx) => {
  await ctx.replyWithHTML(
    `📖 <b>Команды</b> (ответом на сообщение):\n\n`+
    `/warn [причина] — варн\n`+
    `/warns — список варнов\n`+
    `/clearwarns — сбросить варны\n`+
    `/mute [мин] [причина] — мут\n`+
    `/unmute — снять мут\n`+
    `/kick [причина] — кик\n`+
    `/ban [причина] — бан\n`+
    `/unban — разбан\n`+
    `/promote [1-5] — назначить уровень\n`+
    `/demote — снять уровень\n`+
    `/admins — список бот-админов\n`+
    `/levels — таблица уровней\n`+
    `/ping — проверить работу бота`
  );
});

// ── /ping ─────────────────────────────────────────────────
bot.command("ping", async (ctx) => {
  const lvl = getUserLevel(ctx.chat.id, ctx.from.id);
  await ctx.replyWithHTML(
    `✅ <b>Бот работает!</b>\n`+
    `Чат ID: <code>${ctx.chat.id}</code>\n`+
    `Тип чата: <code>${ctx.chat.type}</code>\n`+
    `Твой ID: <code>${ctx.from.id}</code>\n`+
    `Твой уровень: <b>${lvl}</b> (${LEVELS[lvl]?.name ?? "?"})`
  );
});

// ── /levels ───────────────────────────────────────────────
bot.command("levels", async (ctx) => {
  let text = `🎖 <b>Уровни</b>\n\n`;
  for (const [lvl, info] of Object.entries(LEVELS)) {
    if (Number(lvl) === 0) continue;
    const p = [];
    if (info.can_warn)    p.push("варны");
    if (info.can_mute)    p.push("муты");
    if (info.can_kick)    p.push("кик");
    if (info.can_ban)     p.push("бан");
    if (info.can_promote) p.push(`повышение до ур.${info.max_promote}`);
    if (info.can_demote)  p.push("понижение");
    text += `${info.name} — <i>${p.join(", ")}</i>\n`;
  }
  await ctx.replyWithHTML(text);
});

// ── /warn ─────────────────────────────────────────────────
bot.command("warn", async (ctx) => {
  if (ctx.chat.type === "private") return ctx.reply("❌ Только для групп.");
  if (!await canDo(ctx, ctx.from.id, "can_warn"))
    return ctx.reply("❌ Нужен уровень 1+.");
  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");
  if (target.id === ctx.from.id) return ctx.reply("❌ Нельзя варнить себя.");
  if (target.is_bot) return ctx.reply("❌ Нельзя варнить ботов.");
  const args = ctx.message.text.split(/\s+/).slice(1);
  const reason = args.join(" ") || "нарушение правил";
  const cnt = addWarn(ctx.chat.id, target.id, reason);
  if (cnt >= MAX_WARNS) {
    const until = new Date(Date.now() + 24*60*60*1000);
    try {
      await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
        permissions: { can_send_messages: false },
        until_date: Math.floor(until.getTime()/1000),
      });
      clearWarns(ctx.chat.id, target.id);
      await ctx.replyWithHTML(`⚠️ ${mention(target)} — варн <b>${cnt}/${MAX_WARNS}</b>\nПричина: ${esc(reason)}\n🔇 Автомут на <b>24 часа</b>!`);
    } catch(e) { await ctx.reply(`Варн выдан, замутить не удалось: ${e.message}`); }
  } else {
    await ctx.replyWithHTML(`⚠️ ${mention(target)} — предупреждение!\nПричина: ${esc(reason)}\nВарны: <b>${cnt}/${MAX_WARNS}</b> (до мута: ${MAX_WARNS-cnt})`);
  }
});

// ── /warns ────────────────────────────────────────────────
bot.command("warns", async (ctx) => {
  if (ctx.chat.type === "private") return;
  const target = ctx.message.reply_to_message?.from ?? ctx.from;
  const warns = getWarns(ctx.chat.id, target.id);
  if (!warns.length) return ctx.replyWithHTML(`✅ У ${mention(target)} нет варнов.`);
  let text = `📋 Варны ${mention(target)} (<b>${warns.length}/${MAX_WARNS}</b>):\n\n`;
  warns.forEach((w,i) => { text += `${i+1}. ${esc(w.reason)} — <i>${w.date.slice(0,10)}</i>\n`; });
  await ctx.replyWithHTML(text);
});

// ── /clearwarns ───────────────────────────────────────────
bot.command("clearwarns", async (ctx) => {
  if (ctx.chat.type === "private") return;
  if (!await canDo(ctx, ctx.from.id, "can_warn")) return ctx.reply("❌ Нужен уровень 1+.");
  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");
  clearWarns(ctx.chat.id, target.id);
  await ctx.replyWithHTML(`✅ Варны ${mention(target)} сброшены.`);
});

// ── /mute ─────────────────────────────────────────────────
bot.command("mute", async (ctx) => {
  if (ctx.chat.type === "private") return ctx.reply("❌ Только для групп.");
  if (!await canDo(ctx, ctx.from.id, "can_mute")) return ctx.reply("❌ Нужен уровень 1+.");
  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение.\nПример: /mute 60 спам");
  if (target.is_bot) return ctx.reply("❌ Нельзя мутить ботов.");
  const args = ctx.message.text.split(/\s+/).slice(1);
  let minutes = 60, reason = "нарушение правил";
  if (args.length && !isNaN(args[0])) { minutes = parseInt(args[0]); reason = args.slice(1).join(" ") || reason; }
  else { reason = args.join(" ") || reason; }
  const until = new Date(Date.now() + minutes*60*1000);
  try {
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
      permissions: { can_send_messages: false },
      until_date: Math.floor(until.getTime()/1000),
    });
    await ctx.replyWithHTML(`🔇 ${mention(target)} замучен на <b>${fmtTime(minutes)}</b>\nПричина: ${esc(reason)}`);
  } catch(e) { await ctx.reply(`❌ Ошибка: ${e.message}`); }
});

// ── /unmute ───────────────────────────────────────────────
bot.command("unmute", async (ctx) => {
  if (ctx.chat.type === "private") return;
  if (!await canDo(ctx, ctx.from.id, "can_unmute")) return ctx.reply("❌ Нужен уровень 1+.");
  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");
  try {
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
      permissions: { can_send_messages:true, can_send_media_messages:true, can_send_polls:true, can_send_other_messages:true, can_add_web_page_previews:true },
    });
    await ctx.replyWithHTML(`🔊 ${mention(target)} размучен.`);
  } catch(e) { await ctx.reply(`❌ Ошибка: ${e.message}`); }
});

// ── /kick ─────────────────────────────────────────────────
bot.command("kick", async (ctx) => {
  if (ctx.chat.type === "private") return;
  if (!await canDo(ctx, ctx.from.id, "can_kick")) return ctx.reply("❌ Нужен уровень 2+.");
  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");
  if (target.is_bot) return ctx.reply("❌ Нельзя кикнуть бота.");
  const reason = ctx.message.text.split(/\s+/).slice(1).join(" ") || "нарушение правил";
  try {
    await ctx.telegram.banChatMember(ctx.chat.id, target.id);
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id);
    await ctx.replyWithHTML(`👢 ${mention(target)} кикнут.\nПричина: ${esc(reason)}`);
  } catch(e) { await ctx.reply(`❌ Ошибка: ${e.message}`); }
});

// ── /ban ──────────────────────────────────────────────────
bot.command("ban", async (ctx) => {
  if (ctx.chat.type === "private") return;
  if (!await canDo(ctx, ctx.from.id, "can_ban")) return ctx.reply("❌ Нужен уровень 4+.");
  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");
  if (target.id === ctx.from.id) return ctx.reply("❌ Нельзя банить себя.");
  if (target.is_bot) return ctx.reply("❌ Нельзя банить ботов.");
  const reason = ctx.message.text.split(/\s+/).slice(1).join(" ") || "нарушение правил";
  try {
    await ctx.telegram.banChatMember(ctx.chat.id, target.id);
    clearWarns(ctx.chat.id, target.id);
    await ctx.replyWithHTML(`🔨 ${mention(target)} <b>заблокирован</b>.\nПричина: ${esc(reason)}`);
  } catch(e) { await ctx.reply(`❌ Ошибка: ${e.message}`); }
});

// ── /unban ────────────────────────────────────────────────
bot.command("unban", async (ctx) => {
  if (ctx.chat.type === "private") return;
  if (!await canDo(ctx, ctx.from.id, "can_unban")) return ctx.reply("❌ Нужен уровень 4+.");
  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");
  try {
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id);
    await ctx.replyWithHTML(`✅ ${mention(target)} разблокирован.`);
  } catch(e) { await ctx.reply(`❌ Ошибка: ${e.message}`); }
});

// ── /promote ──────────────────────────────────────────────
bot.command("promote", async (ctx) => {
  if (ctx.chat.type === "private") return;
  const execId = ctx.from.id, chatId = ctx.chat.id;
  const execLvl = getUserLevel(chatId, execId);
  const isOwner = await isTgCreator(ctx, execId);
  if (!await canDo(ctx, execId, "can_promote"))
    return ctx.reply("❌ Нужен уровень 3+ для назначения.");
  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение.\nПример: /promote 2");
  if (target.is_bot) return ctx.reply("❌ Нельзя назначить уровень боту.");
  if (target.id === execId) return ctx.reply("❌ Нельзя повышать себя.");
  const args = ctx.message.text.split(/\s+/).slice(1);
  if (!args.length || isNaN(args[0])) return ctx.reply("❌ Укажите уровень: /promote 1-5");
  const newLvl = parseInt(args[0]);
  if (!LEVELS[newLvl] || newLvl < 1) return ctx.reply("❌ Уровень от 1 до 5.");
  const maxAllowed = isOwner ? 5 : LEVELS[execLvl]?.max_promote ?? 0;
  if (newLvl > maxAllowed) return ctx.reply(`❌ Вы можете повышать максимум до уровня ${maxAllowed}.`);
  setUserLevel(chatId, target.id, newLvl);
  const info = LEVELS[newLvl];
  await ctx.replyWithHTML(
    `✅ ${mention(target)} назначен: <b>${info.name}</b>\n\n`+
    `${info.can_warn?"✅":"❌"} Варны  ${info.can_mute?"✅":"❌"} Муты  ${info.can_kick?"✅":"❌"} Кик\n`+
    `${info.can_ban?"✅":"❌"} Бан  ${info.can_promote?"✅":"❌"} Повышение до ур.${info.max_promote}  ${info.can_demote?"✅":"❌"} Понижение`
  );
});

// ── /demote ───────────────────────────────────────────────
bot.command("demote", async (ctx) => {
  if (ctx.chat.type === "private") return;
  const execId = ctx.from.id, chatId = ctx.chat.id;
  const execLvl = getUserLevel(chatId, execId);
  const isOwner = await isTgCreator(ctx, execId);
  if (!await canDo(ctx, execId, "can_demote"))
    return ctx.reply("❌ Нужен уровень 3+ для понижения.");
  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");
  if (target.id === execId) return ctx.reply("❌ Нельзя понижать себя.");
  const targetLvl = getUserLevel(chatId, target.id);
  if (targetLvl === 0) return ctx.reply("❌ У этого пользователя нет уровня в боте.");
  if (!isOwner && targetLvl >= execLvl) return ctx.reply("❌ Нельзя понижать того, кто на вашем уровне или выше.");
  const oldName = LEVELS[targetLvl].name;
  setUserLevel(chatId, target.id, 0);
  await ctx.replyWithHTML(`🔻 ${mention(target)} снят с должности <b>${oldName}</b>.`);
});

// ── /admins ───────────────────────────────────────────────
bot.command("admins", async (ctx) => {
  if (ctx.chat.type === "private") return;
  const chatId = ctx.chat.id;
  const data = loadData();
  const entries = Object.entries(data.admins)
    .filter(([k,v]) => k.startsWith(`${chatId}:`) && v > 0)
    .sort(([,a],[,b]) => b - a);
  if (!entries.length) return ctx.reply("📋 Назначенных ботом администраторов нет.");
  let text = `📋 <b>Команда (бот-уровни):</b>\n\n`;
  for (const [k,lvl] of entries) {
    const uid = k.split(":")[1];
    const info = LEVELS[lvl];
    text += `${info.emoji} <a href="tg://user?id=${uid}">${uid}</a> — ${info.name}\n`;
  }
  await ctx.replyWithHTML(text);
});

// ══════════════════════════════════════════════════════════
//  ФИЛЬТР МАТОВ — ВСЕГДА ПОСЛЕДНИМ!
// ══════════════════════════════════════════════════════════
bot.on("message", async (ctx) => {
  if (!["group","supergroup"].includes(ctx.chat?.type)) return;

  const text = ctx.message?.text || ctx.message?.caption;
  if (!text || text.startsWith("/")) return;
  if (!hasBadWord(text)) return;

  const user = ctx.message.from;
  if (await isTgAdmin(ctx, user.id)) return;

  try { await ctx.deleteMessage(); } catch(e) { console.log("Удалить не удалось:", e.message); }

  const cnt = addWarn(ctx.chat.id, user.id, "мат в чате");

  if (cnt >= MAX_WARNS) {
    const until = new Date(Date.now() + 24*60*60*1000);
    try {
      await ctx.telegram.restrictChatMember(ctx.chat.id, user.id, {
        permissions: { can_send_messages: false },
        until_date: Math.floor(until.getTime()/1000),
      });
      clearWarns(ctx.chat.id, user.id);
      await ctx.replyWithHTML(`🔇 ${mention(user)} замучен на <b>24 часа</b> за мат! (${MAX_WARNS}/${MAX_WARNS} варнов)`);
    } catch(e) {
      await ctx.replyWithHTML(`⚠️ ${mention(user)}, мат запрещён! Не удалось замутить: ${e.message}`);
    }
  } else {
    await ctx.replyWithHTML(
      `🚫 ${mention(user)}, мат запрещён!\n`+
      `⚠️ Варн <b>${cnt}/${MAX_WARNS}</b> — до мута: <b>${MAX_WARNS-cnt}</b>`
    );
  }
});

// ══════════════════════════════════════════════════════════
//  ЗАПУСК
// ══════════════════════════════════════════════════════════
bot.launch().then(() => {
  console.log("✅ Бот запущен! Напиши /ping в группе для проверки.");
});

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));