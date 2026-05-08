const { Telegraf, Markup } = require("telegraf");
const fs = require("fs");

// ══════════════════════════════════════════════════════════
//  НАСТРОЙКИ
// ══════════════════════════════════════════════════════════
const BOT_TOKEN = "8504491637:AAFp4OICErng0RbNOmiN4msiGAlJWmbJq-M"; // получи у @BotFather
const DATA_FILE = "data.json";
const MAX_WARNS = 3; // варнов до авто-мута

// ── Маты ──────────────────────────────────────────────────
const BAD_WORDS = [
  "бля", "блять", "блядь", "сука", "пизда", "пиздец",
  "хуй", "хуйня", "ёбаный", "ебать", "еблан", "залупа",
  "мразь", "мудак", "пидор", "пидорас", "ублюдок", "шлюха",
  "проститутка", "нахуй", "нахер", "хер", "ёб твою",
  "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick",
];

// ── Уровни (0 = обычный пользователь) ─────────────────────
const LEVELS = {
  0: { name: "👤 Пользователь",   emoji: "👤", can_warn: false, can_mute: false, can_unmute: false, can_kick: false, can_ban: false, can_unban: false, can_promote: false, can_demote: false, max_promote: 0 },
  1: { name: "🟢 Модератор",      emoji: "🟢", can_warn: true,  can_mute: true,  can_unmute: true,  can_kick: false, can_ban: false, can_unban: false, can_promote: false, can_demote: false, max_promote: 0 },
  2: { name: "🔵 Старший мод",    emoji: "🔵", can_warn: true,  can_mute: true,  can_unmute: true,  can_kick: true,  can_ban: false, can_unban: false, can_promote: false, can_demote: false, max_promote: 0 },
  3: { name: "🟣 Администратор",  emoji: "🟣", can_warn: true,  can_mute: true,  can_unmute: true,  can_kick: true,  can_ban: false, can_unban: false, can_promote: true,  can_demote: true,  max_promote: 2 },
  4: { name: "🔴 Главный админ",  emoji: "🔴", can_warn: true,  can_mute: true,  can_unmute: true,  can_kick: true,  can_ban: true,  can_unban: true,  can_promote: true,  can_demote: true,  max_promote: 3 },
  5: { name: "👑 Владелец",       emoji: "👑", can_warn: true,  can_mute: true,  can_unmute: true,  can_kick: true,  can_ban: true,  can_unban: true,  can_promote: true,  can_demote: true,  max_promote: 4 },
};

// ══════════════════════════════════════════════════════════
//  РАБОТА С ДАННЫМИ
// ══════════════════════════════════════════════════════════
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
  return { warns: {}, admins: {}, banned: {} };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

function key(chatId, userId) {
  return `${chatId}:${userId}`;
}

function getUserLevel(chatId, userId) {
  const data = loadData();
  return data.admins[key(chatId, userId)] ?? 0;
}

function setUserLevel(chatId, userId, level) {
  const data = loadData();
  data.admins[key(chatId, userId)] = level;
  saveData(data);
}

// ══════════════════════════════════════════════════════════
//  ХЕЛПЕРЫ
// ══════════════════════════════════════════════════════════
function containsBadWord(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return BAD_WORDS.some((w) => lower.includes(w));
}

function mention(user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return `<a href="tg://user?id=${user.id}">${escapeHtml(name)}</a>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes} мин.`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} ч. ${m} мин.` : `${h} ч.`;
}

async function isTgAdmin(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return ["administrator", "creator"].includes(member.status);
  } catch {
    return false;
  }
}

async function isTgCreator(ctx, userId) {
  try {
    const member = await ctx.telegram.getChatMember(ctx.chat.id, userId);
    return member.status === "creator";
  } catch {
    return false;
  }
}

// Проверка: есть ли право у пользователя
async function hasPermission(ctx, userId, perm) {
  const level = getUserLevel(ctx.chat.id, userId);
  if (LEVELS[level]?.[perm]) return true;
  // Telegram-владелец/админ тоже имеет все права
  if (await isTgCreator(ctx, userId)) return true;
  return false;
}

// Добавить варн, вернуть новое кол-во
function addWarn(chatId, userId, reason) {
  const data = loadData();
  const k = key(chatId, userId);
  if (!data.warns[k]) data.warns[k] = [];
  data.warns[k].push({ reason, date: new Date().toISOString() });
  saveData(data);
  return data.warns[k].length;
}

function clearWarns(chatId, userId) {
  const data = loadData();
  data.warns[key(chatId, userId)] = [];
  saveData(data);
}

function getWarns(chatId, userId) {
  const data = loadData();
  return data.warns[key(chatId, userId)] ?? [];
}

// ══════════════════════════════════════════════════════════
//  БОТ
// ══════════════════════════════════════════════════════════
const bot = new Telegraf(BOT_TOKEN);

// Логирование всех входящих команд
bot.use((ctx, next) => {
  if (ctx.message?.text?.startsWith("/")) {
    console.log(`📨 Команда от ${ctx.from.id} в чате ${ctx.chat.id} (${ctx.chat.type}): ${ctx.message.text}`);
  }
  return next();
});

// Игнор личных сообщений для большинства команд
function groupCheck(ctx) {
  if (ctx.chat.type === "private") {
    ctx.reply("❌ Команда работает только в группах.");
    return false;
  }
  return true;
}

// ── /start ────────────────────────────────────────────────
bot.start(async (ctx) => {
  await ctx.replyWithHTML(
    `👋 <b>Привет! Я бот-модератор.</b>\n\n` +
    `Добавь меня в группу, выдай права администратора и я буду:\n` +
    `• 🚫 Удалять маты и выдавать варны\n` +
    `• 🔇 Мутить / кикать / банить нарушителей\n` +
    `• 🎖 Управлять уровнями команды\n\n` +
    `Напиши <code>/help</code> для списка команд.`
  );
});

// ── /help ─────────────────────────────────────────────────
bot.command("help", async (ctx) => {
  await ctx.replyWithHTML(
    `📖 <b>Команды бота</b>\n\n` +
    `<b>Модерация</b> (ответом на сообщение):\n` +
    `• /warn [причина] — предупреждение\n` +
    `• /warns — посмотреть варны\n` +
    `• /clearwarns — сбросить варны\n` +
    `• /mute [минуты] [причина] — заглушить\n` +
    `• /unmute — снять мут\n` +
    `• /kick [причина] — кик\n` +
    `• /ban [причина] — бан\n` +
    `• /unban — разбан\n\n` +
    `<b>Управление командой:</b>\n` +
    `• /promote [уровень] — повысить (ответом)\n` +
    `• /demote — понизить (ответом)\n` +
    `• /admins — список администраторов\n` +
    `• /levels — таблица уровней\n\n` +
    `<b>Авто-модерация:</b>\n` +
    `🚫 Мат → удаление + варн\n` +
    `⚠️ ${MAX_WARNS} варна → мут 24ч`
  );
});

// ── /levels ───────────────────────────────────────────────
bot.command("levels", async (ctx) => {
  let text = `🎖 <b>Система уровней</b>\n\n`;
  for (const [lvl, info] of Object.entries(LEVELS)) {
    if (Number(lvl) === 0) continue;
    const perms = [];
    if (info.can_warn)    perms.push("варны");
    if (info.can_mute)    perms.push("муты");
    if (info.can_kick)    perms.push("кик");
    if (info.can_ban)     perms.push("бан");
    if (info.can_promote) perms.push(`повышение до ур.${info.max_promote}`);
    if (info.can_demote)  perms.push("понижение");
    text += `${info.name}\n<i>${perms.join(" • ")}</i>\n\n`;
  }
  await ctx.replyWithHTML(text);
});

// ══════════════════════════════════════════════════════════
//  АВТО-ФИЛЬТР МАТОВ
// ══════════════════════════════════════════════════════════
bot.on("text", async (ctx) => {
  if (ctx.chat.type === "private") return;
  // Пропускаем команды
  if (ctx.message.text?.startsWith("/")) return;

  if (!containsBadWord(ctx.message.text)) return;

  const user = ctx.message.from;
  const chatId = ctx.chat.id;

  // Не удаляем сообщения у Telegram-админов
  if (await isTgAdmin(ctx, user.id)) return;

  // Удаляем сообщение
  try { await ctx.deleteMessage(); } catch {}

  const warnCount = addWarn(chatId, user.id, "мат в чате");

  if (warnCount >= MAX_WARNS) {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      await ctx.telegram.restrictChatMember(chatId, user.id, {
        permissions: { can_send_messages: false },
        until_date: Math.floor(until.getTime() / 1000),
      });
      clearWarns(chatId, user.id);
      await ctx.replyWithHTML(
        `🔇 ${mention(user)} замучен на <b>24 часа</b> за мат!\n` +
        `(${MAX_WARNS}/${MAX_WARNS} варнов — варны сброшены)`
      );
    } catch (e) {
      await ctx.replyWithHTML(`⚠️ ${mention(user)}, мат запрещён! Не удалось замутить: ${e.message}`);
    }
  } else {
    const left = MAX_WARNS - warnCount;
    await ctx.replyWithHTML(
      `🚫 ${mention(user)}, мат запрещён!\n` +
      `⚠️ Варн <b>${warnCount}/${MAX_WARNS}</b> — до мута осталось <b>${left}</b>`
    );
  }
});

// ══════════════════════════════════════════════════════════
//  /warn
// ══════════════════════════════════════════════════════════
bot.command("warn", async (ctx) => {
  if (!groupCheck(ctx)) return;
  if (!await hasPermission(ctx, ctx.from.id, "can_warn"))
    return ctx.reply("❌ Недостаточно прав (нужен уровень 1+).");

  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");
  if (target.id === ctx.from.id) return ctx.reply("❌ Нельзя варнить себя.");
  if (target.is_bot) return ctx.reply("❌ Нельзя варнить ботов.");

  const args = ctx.message.text.split(/\s+/).slice(1);
  const reason = args.join(" ") || "нарушение правил";
  const warnCount = addWarn(ctx.chat.id, target.id, reason);

  if (warnCount >= MAX_WARNS) {
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
    try {
      await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
        permissions: { can_send_messages: false },
        until_date: Math.floor(until.getTime() / 1000),
      });
      clearWarns(ctx.chat.id, target.id);
      await ctx.replyWithHTML(
        `⚠️ ${mention(target)} — варн <b>${warnCount}/${MAX_WARNS}</b>\n` +
        `Причина: ${escapeHtml(reason)}\n` +
        `🔇 Автоматически замучен на <b>24 часа</b>!`
      );
    } catch (e) {
      await ctx.replyWithHTML(`Варн выдан, но замутить не удалось: ${e.message}`);
    }
  } else {
    const left = MAX_WARNS - warnCount;
    await ctx.replyWithHTML(
      `⚠️ ${mention(target)} получил предупреждение!\n` +
      `Причина: ${escapeHtml(reason)}\n` +
      `Варны: <b>${warnCount}/${MAX_WARNS}</b> (до мута: ${left})`
    );
  }
});

// ══════════════════════════════════════════════════════════
//  /warns
// ══════════════════════════════════════════════════════════
bot.command("warns", async (ctx) => {
  if (!groupCheck(ctx)) return;
  const target = ctx.message.reply_to_message?.from ?? ctx.from;
  const warns = getWarns(ctx.chat.id, target.id);

  if (!warns.length)
    return ctx.replyWithHTML(`✅ У ${mention(target)} нет варнов.`);

  let text = `📋 Варны ${mention(target)} (<b>${warns.length}/${MAX_WARNS}</b>):\n\n`;
  warns.forEach((w, i) => {
    const date = w.date.slice(0, 10);
    text += `${i + 1}. ${escapeHtml(w.reason)} — <i>${date}</i>\n`;
  });
  await ctx.replyWithHTML(text);
});

// ══════════════════════════════════════════════════════════
//  /clearwarns
// ══════════════════════════════════════════════════════════
bot.command("clearwarns", async (ctx) => {
  if (!groupCheck(ctx)) return;
  if (!await hasPermission(ctx, ctx.from.id, "can_warn"))
    return ctx.reply("❌ Недостаточно прав.");

  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");

  clearWarns(ctx.chat.id, target.id);
  await ctx.replyWithHTML(`✅ Варны ${mention(target)} сброшены.`);
});

// ══════════════════════════════════════════════════════════
//  /mute
// ══════════════════════════════════════════════════════════
bot.command("mute", async (ctx) => {
  if (!groupCheck(ctx)) return;
  if (!await hasPermission(ctx, ctx.from.id, "can_mute"))
    return ctx.reply("❌ Недостаточно прав (нужен уровень 1+).");

  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение.\nПример: /mute 60 спам");
  if (target.is_bot) return ctx.reply("❌ Нельзя мутить ботов.");

  const args = ctx.message.text.split(/\s+/).slice(1);
  let minutes = 60;
  let reason = "нарушение правил";

  if (args.length > 0 && !isNaN(args[0])) {
    minutes = parseInt(args[0]);
    reason = args.slice(1).join(" ") || reason;
  } else {
    reason = args.join(" ") || reason;
  }

  const until = new Date(Date.now() + minutes * 60 * 1000);
  try {
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
      permissions: { can_send_messages: false },
      until_date: Math.floor(until.getTime() / 1000),
    });
    await ctx.replyWithHTML(
      `🔇 ${mention(target)} замучен на <b>${formatDuration(minutes)}</b>\n` +
      `Причина: ${escapeHtml(reason)}`
    );
  } catch (e) {
    await ctx.reply(`❌ Ошибка: ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════════
//  /unmute
// ══════════════════════════════════════════════════════════
bot.command("unmute", async (ctx) => {
  if (!groupCheck(ctx)) return;
  if (!await hasPermission(ctx, ctx.from.id, "can_unmute"))
    return ctx.reply("❌ Недостаточно прав.");

  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");

  try {
    await ctx.telegram.restrictChatMember(ctx.chat.id, target.id, {
      permissions: {
        can_send_messages: true,
        can_send_media_messages: true,
        can_send_polls: true,
        can_send_other_messages: true,
        can_add_web_page_previews: true,
      },
    });
    await ctx.replyWithHTML(`🔊 ${mention(target)} размучен.`);
  } catch (e) {
    await ctx.reply(`❌ Ошибка: ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════════
//  /kick
// ══════════════════════════════════════════════════════════
bot.command("kick", async (ctx) => {
  if (!groupCheck(ctx)) return;
  if (!await hasPermission(ctx, ctx.from.id, "can_kick"))
    return ctx.reply("❌ Недостаточно прав (нужен уровень 2+).");

  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");
  if (target.is_bot) return ctx.reply("❌ Нельзя кикнуть бота.");

  const args = ctx.message.text.split(/\s+/).slice(1);
  const reason = args.join(" ") || "нарушение правил";

  try {
    await ctx.telegram.banChatMember(ctx.chat.id, target.id);
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id); // кик = бан + разбан
    await ctx.replyWithHTML(
      `👢 ${mention(target)} кикнут из группы.\nПричина: ${escapeHtml(reason)}`
    );
  } catch (e) {
    await ctx.reply(`❌ Ошибка: ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════════
//  /ban
// ══════════════════════════════════════════════════════════
bot.command("ban", async (ctx) => {
  if (!groupCheck(ctx)) return;
  if (!await hasPermission(ctx, ctx.from.id, "can_ban"))
    return ctx.reply("❌ Недостаточно прав (нужен уровень 4+).");

  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");
  if (target.is_bot) return ctx.reply("❌ Нельзя банить ботов.");
  if (target.id === ctx.from.id) return ctx.reply("❌ Нельзя банить себя.");

  const args = ctx.message.text.split(/\s+/).slice(1);
  const reason = args.join(" ") || "нарушение правил";

  try {
    await ctx.telegram.banChatMember(ctx.chat.id, target.id);
    clearWarns(ctx.chat.id, target.id);
    await ctx.replyWithHTML(
      `🔨 ${mention(target)} <b>заблокирован</b> навсегда.\nПричина: ${escapeHtml(reason)}`
    );
  } catch (e) {
    await ctx.reply(`❌ Ошибка: ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════════
//  /unban
// ══════════════════════════════════════════════════════════
bot.command("unban", async (ctx) => {
  if (!groupCheck(ctx)) return;
  if (!await hasPermission(ctx, ctx.from.id, "can_unban"))
    return ctx.reply("❌ Недостаточно прав (нужен уровень 4+).");

  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");

  try {
    await ctx.telegram.unbanChatMember(ctx.chat.id, target.id);
    await ctx.replyWithHTML(`✅ ${mention(target)} разблокирован.`);
  } catch (e) {
    await ctx.reply(`❌ Ошибка: ${e.message}`);
  }
});

// ══════════════════════════════════════════════════════════
//  /promote
// ══════════════════════════════════════════════════════════
bot.command("promote", async (ctx) => {
  if (!groupCheck(ctx)) return;
  const executorId = ctx.from.id;
  const chatId = ctx.chat.id;
  const executorLevel = getUserLevel(chatId, executorId);
  const isTgOwner = await isTgCreator(ctx, executorId);

  if (!await hasPermission(ctx, executorId, "can_promote"))
    return ctx.reply("❌ Недостаточно прав для повышения (нужен уровень 3+).");

  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.\nПример: /promote 2");
  if (target.is_bot) return ctx.reply("❌ Нельзя назначить уровень боту.");
  if (target.id === executorId) return ctx.reply("❌ Нельзя повышать себя.");

  const args = ctx.message.text.split(/\s+/).slice(1);
  if (!args.length || isNaN(args[0]))
    return ctx.reply("❌ Укажите уровень: /promote 1-5");

  const newLevel = parseInt(args[0]);
  if (!LEVELS[newLevel] || newLevel < 1)
    return ctx.reply("❌ Уровень от 1 до 5.");

  const maxAllowed = isTgOwner ? 5 : LEVELS[executorLevel]?.max_promote ?? 0;
  if (newLevel > maxAllowed)
    return ctx.reply(`❌ Вы можете повышать максимум до уровня ${maxAllowed}.`);

  setUserLevel(chatId, target.id, newLevel);
  const info = LEVELS[newLevel];

  await ctx.replyWithHTML(
    `✅ ${mention(target)} назначен на должность <b>${info.name}</b>!\n\n` +
    `Права:\n` +
    `${info.can_warn    ? "✅" : "❌"} Варны\n` +
    `${info.can_mute    ? "✅" : "❌"} Муты/размуты\n` +
    `${info.can_kick    ? "✅" : "❌"} Кик\n` +
    `${info.can_ban     ? "✅" : "❌"} Бан/разбан\n` +
    `${info.can_promote ? "✅" : "❌"} Повышение (до ур.${info.max_promote})\n` +
    `${info.can_demote  ? "✅" : "❌"} Понижение`
  );
});

// ══════════════════════════════════════════════════════════
//  /demote
// ══════════════════════════════════════════════════════════
bot.command("demote", async (ctx) => {
  if (!groupCheck(ctx)) return;
  const executorId = ctx.from.id;
  const chatId = ctx.chat.id;
  const executorLevel = getUserLevel(chatId, executorId);
  const isTgOwner = await isTgCreator(ctx, executorId);

  if (!await hasPermission(ctx, executorId, "can_demote"))
    return ctx.reply("❌ Недостаточно прав для понижения (нужен уровень 3+).");

  const target = ctx.message.reply_to_message?.from;
  if (!target) return ctx.reply("❌ Ответьте на сообщение пользователя.");
  if (target.id === executorId) return ctx.reply("❌ Нельзя понижать себя.");

  const targetLevel = getUserLevel(chatId, target.id);
  if (targetLevel === 0) return ctx.reply("❌ У этого пользователя нет уровня в боте.");

  // Нельзя понижать того, кто на том же или выше уровне (кроме Telegram-владельца)
  if (!isTgOwner && targetLevel >= executorLevel)
    return ctx.reply(`❌ Нельзя понижать пользователя с уровнем >= вашего.`);

  const oldInfo = LEVELS[targetLevel];
  setUserLevel(chatId, target.id, 0);

  await ctx.replyWithHTML(
    `🔻 ${mention(target)} снят с должности <b>${oldInfo.name}</b>.`
  );
});

// ══════════════════════════════════════════════════════════
//  /admins
// ══════════════════════════════════════════════════════════
bot.command("admins", async (ctx) => {
  if (!groupCheck(ctx)) return;
  const chatId = ctx.chat.id;
  const data = loadData();

  const entries = Object.entries(data.admins)
    .filter(([k, v]) => k.startsWith(`${chatId}:`) && v > 0)
    .sort(([, a], [, b]) => b - a);

  if (!entries.length)
    return ctx.reply("📋 Назначенных ботом администраторов нет.");

  let text = `📋 <b>Команда (бот-уровни):</b>\n\n`;
  for (const [k, level] of entries) {
    const userId = k.split(":")[1];
    const info = LEVELS[level];
    text += `${info.emoji} <a href="tg://user?id=${userId}">${userId}</a> — ${info.name}\n`;
  }
  await ctx.replyWithHTML(text);
});

// ══════════════════════════════════════════════════════════
//  ЗАПУСК
// ══════════════════════════════════════════════════════════
bot.launch().then(() => {
  console.log("✅ Бот запущен!");
  console.log("🔑 Токен валиден");
}).catch(err => {
  console.error("❌ Ошибка запуска:", err.message);
  process.exit(1);
});

bot.catch((err, ctx) => {
  console.error("❌ Ошибка в обработчике:", err.message);
});

process.once("SIGINT",  () => {
  console.log("🛑 Бот остановлен");
  bot.stop("SIGINT");
});
process.once("SIGTERM", () => {
  console.log("🛑 Бот остановлен");
  bot.stop("SIGTERM");
});