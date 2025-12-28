import json
import logging
import sqlite3
from datetime import datetime
from contextlib import closing

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes

# ===== НАСТРОЙКИ =====
BOT_TOKEN = "8508725889:AAEerg-qwzxYPlzyFCPhufxiUBu-Z7FMNs8"  # ← ЗАМЕНИТЕ!
WEB_APP_URL = "https://mario-telegram12342.vercel.app"  # ← ЗАМЕНИТЕ! (например: https://mario.vercel.app/mario/)

# ===== БАЗА ДАННЫХ =====
DB_PATH = "mario_data.db"

def init_db():
    with closing(sqlite3.connect(DB_PATH)) as conn:
        # Облачные сохранения
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cloud_saves (
                user_id INTEGER PRIMARY KEY,
                save_data TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        # Рейтинг
        conn.execute("""
            CREATE TABLE IF NOT EXISTS leaderboard (
                user_id INTEGER PRIMARY KEY,
                username TEXT NOT NULL,
                level INTEGER DEFAULT 1,
                coins INTEGER DEFAULT 0,
                last_updated TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_rank ON leaderboard(level DESC, coins DESC)")
        conn.commit()

init_db()

def save_to_cloud(user_id: int,  dict):
    try:
        save_json = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        with closing(sqlite3.connect(DB_PATH)) as conn:
            conn.execute("""
                INSERT OR REPLACE INTO cloud_saves (user_id, save_data, updated_at)
                VALUES (?, ?, ?)
            """, (user_id, save_json, datetime.utcnow().isoformat()))
            conn.commit()
        return True
    except Exception as e:
        logging.error(f"Cloud save failed for {user_id}: {e}")
        return False

def load_from_cloud(user_id: int):
    try:
        with closing(sqlite3.connect(DB_PATH)) as conn:
            row = conn.execute("SELECT save_data FROM cloud_saves WHERE user_id = ?", (user_id,)).fetchone()
            if row:
                return json.loads(row[0])
    except Exception as e:
        logging.error(f"Cloud load failed for {user_id}: {e}")
    return None

def update_leaderboard(user_id: int, username: str, level: int, coins: int):
    try:
        with closing(sqlite3.connect(DB_PATH)) as conn:
            conn.execute("""
                INSERT INTO leaderboard (user_id, username, level, coins, last_updated)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    username = excluded.username,
                    level = excluded.level,
                    coins = excluded.coins,
                    last_updated = excluded.last_updated
            """, (user_id, username or f"user{user_id}", level, coins, datetime.utcnow().isoformat()))
            conn.commit()
        return True
    except Exception as e:
        logging.error(f"Leaderboard update failed for {user_id}: {e}")
        return False

def get_leaderboard(limit: int = 10):
    try:
        with closing(sqlite3.connect(DB_PATH)) as conn:
            rows = conn.execute("""
                SELECT user_id, username, level, coins
                FROM leaderboard
                ORDER BY level DESC, coins DESC
                LIMIT ?
            """, (limit,)).fetchall()
            return [
                {"user_id": r[0], "username": r[1], "level": r[2], "coins": r[3]}
                for r in rows
            ]
    except Exception as e:
        logging.error(f"Leaderboard fetch error: {e}")
        return []

# ===== ОБРАБОТЧИКИ =====
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    cloud_save = load_from_cloud(user.id)
    status = ""
    if cloud_save:
        lvl = cloud_save.get("level", 1)
        coins = cloud_save.get("coins", 0)
        status = f"\n💾 Облако: Ур.{lvl}, {coins}💰"

    await update.message.reply_text(
        f"👾 *Марио в Telegram!*{status}\n\nНажмите кнопку, чтобы начать приключение:",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([[
            InlineKeyboardButton(
                "🎮 Играть!",
                web_app=WebAppInfo(url=f"{WEB_APP_URL}?user_id={user.id}&first_name={user.first_name or 'Марио'}")
            )
        ]])
    )

async def rank(update: Update, context: ContextTypes.DEFAULT_TYPE):
    top = get_leaderboard(10)
    if not top:
        await update.message.reply_text("📭 Рейтинг пока пуст.")
        return

    lines = ["🏆 *Топ-10 Марио-героев:*", ""]
    medals = ["🥇", "🥈", "🥉"] + ["  "] * 7
    for i, p in enumerate(top):
        name = p["username"]
        if len(name) > 12:
            name = name[:10] + ".."
        lines.append(f"{medals[i]} {i+1}. *{name}* — Ур.{p['level']}, {p['coins']}💰")

    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")

async def webapp_data(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        data = json.loads(update.message.text)
        if not isinstance(data, dict):
            return

        user = update.effective_user
        if not user:
            return

        # Сохранение прогресса
        if data.get("type") == "cloud_save":
            payload = data.get("payload", {})
            user_id = data.get("user_id")
            if isinstance(user_id, int) and payload:
                save_to_cloud(user_id, payload)
                update_leaderboard(
                    user_id=user_id,
                    username=user.first_name or user.username or f"user{user_id}",
                    level=payload.get("level", 1),
                    coins=payload.get("coins", 0)
                )
                await update.message.reply_text("✅ Сохранено!", reply_to_message_id=update.message.id)

        # Запрос рейтинга
        elif data.get("type") == "request_leaderboard":
            top = get_leaderboard(10)
            response = {
                "source": "telegram",
                "type": "leaderboard_resp",
                "id": data.get("id"),
                "data": top
            }
            await update.message.reply_text(json.dumps(response))

    except Exception as e:
        logging.error(f"WebApp data error: {e}")

# ===== ЗАПУСК =====
def main():
    logging.basicConfig(level=logging.INFO)
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("rank", rank))
    app.add_handler(MessageHandler(filters.StatusUpdate.WEB_APP_DATA, webapp_data))
    app.add_handler(MessageHandler(filters.TEXT, webapp_data))
    app.run_polling()

if __name__ == "__main__":
    main()