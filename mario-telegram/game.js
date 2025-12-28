// =============== ИНИЦИАЛИЗАЦИЯ ===============
const tg = window.Telegram.WebApp;
tg.expand();
tg.MainButton.hide();

const urlParams = new URLSearchParams(window.location.search);
const userId = parseInt(urlParams.get("user_id")) || Date.now();
const userName = urlParams.get("first_name") || "Марио";

if (!userId) {
  alert("❌ Ошибка инициализации. Перезапустите бота.");
  tg.close();
}

// =============== СОХРАНЕНИЕ ===============
let currentSave = null;

function loadLocalSave() {
  const s = localStorage.getItem("mario_save_v2");
  return s ? JSON.parse(s) : null;
}

function saveLocal(data) {
  localStorage.setItem("mario_save_v2", JSON.stringify(data));
}

function saveToCloud(data) {
  if (!userId) return false;
  const payload = {
    type: "cloud_save",
    user_id: userId,
    payload: {
      coins: data.coins,
      level: data.level,
      upgrades: data.upgrades
    }
  };
  tg.sendData(JSON.stringify(payload));
  return true;
}

// =============== ИГРОВОЙ ДВИЖОК ===============
let gameState = null;
let canvas, ctx;

function initGame(saveData) {
  currentSave = { data: saveData };

  // Восстановление UI
  document.getElementById("game-container").innerHTML = `
    <canvas id="game" width="800" height="400"></canvas>
    <div id="ui">
      <span>❤️ HP: <span id="hp">${saveData.upgrades.maxHp}/${saveData.upgrades.maxHp}</span></span> |
      <span>💰 Монет: <span id="coins">${saveData.coins}</span></span> |
      <span>🌟 Ур: <span id="level">${saveData.level}</span></span>
      <button id="shop-btn">🏪 Магазин</button>
      <button id="rank-btn">📊 Рейтинг</button>
    </div>
  `;

  canvas = document.getElementById("game");
  ctx = canvas.getContext("2d");
  const scale = window.devicePixelRatio || 1;
  canvas.width = 800 * scale;
  canvas.height = 400 * scale;
  ctx.scale(scale, scale);

  gameState = {
    player: {
      x: 50, y: 300, width: 32, height: 32,
      velX: 0, velY: 0,
      speed: saveData.upgrades.speed || 5,
      jumpPower: saveData.upgrades.jumpPower || 12,
      maxHp: saveData.upgrades.maxHp || 3,
      hp: saveData.upgrades.maxHp || 3,
      grounded: false,
      jumpsUsed: 0,
      doubleJump: saveData.upgrades.doubleJump || false
    },
    coins: [],
    enemies: [],
    platforms: [{ x: 0, y: 350, w: 800, h: 50 }],
    gravity: 0.5,
    keys: {},
    coinsCollected: saveData.coins || 0,
    level: saveData.level || 1,
    inShop: false
  };

  generateLevel(gameState.level);
  updateUI();

  // Обработчики кнопок
  document.getElementById("shop-btn").onclick = openShop;
  document.getElementById("rank-btn").onclick = showLeaderboard;

  // Ввод
  window.addEventListener("keydown", e => gameState.keys[e.key] = true);
  window.addEventListener("keyup", e => gameState.keys[e.key] = false);

  // Цикл
  requestAnimationFrame(gameLoop);
}

function generateLevel(level) {
  const baseCoins = Math.min(5 + level * 2, 15);
  const baseEnemies = Math.min(Math.floor(level / 2), 5);
  gameState.coins = [];
  gameState.enemies = [];
  gameState.platforms = [{ x: 0, y: 350, w: 800, h: 50 }];

  for (let i = 0; i < 2 + level; i++) {
    gameState.platforms.push({
      x: 150 + i * 200 + Math.random() * 100,
      y: 200 + Math.random() * 100,
      w: 80 + Math.random() * 40,
      h: 20
    });
  }

  for (let i = 0; i < baseCoins; i++) {
    const idx = 1 + Math.floor(Math.random() * (gameState.platforms.length - 1));
    const plat = gameState.platforms[idx];
    gameState.coins.push({
      x: plat.x + Math.random() * (plat.w - 20),
      y: plat.y - 20
    });
  }

  for (let i = 0; i < baseEnemies; i++) {
    gameState.enemies.push({
      x: 300 + i * 200,
      y: 318,
      width: 32,
      height: 32,
      dir: i % 2 === 0 ? -1 : 1,
      speed: 1 + level * 0.1
    });
  }
}

function updateUI() {
  document.getElementById("hp").textContent = `${gameState.player.hp}/${gameState.player.maxHp}`;
  document.getElementById("coins").textContent = gameState.coinsCollected;
  document.getElementById("level").textContent = gameState.level;
}

function draw() {
  ctx.clearRect(0, 0, 800, 400);
  ctx.fillStyle = "#87CEEB";
  ctx.fillRect(0, 0, 800, 400);

  // Платформы
  ctx.fillStyle = "#8B4513";
  gameState.platforms.forEach(p => ctx.fillRect(p.x, p.y, p.w, p.h));

  // Монеты
  ctx.fillStyle = "#FFD700";
  gameState.coins.forEach(c => {
    ctx.beginPath();
    ctx.arc(c.x + 8, c.y + 8, 8, 0, Math.PI * 2);
    ctx.fill();
  });

  // Враги
  ctx.fillStyle = "#2E8B57";
  gameState.enemies.forEach(e => ctx.fillRect(e.x, e.y, e.width, e.height));

  // Игрок
  ctx.fillStyle = gameState.player.doubleJump ? "#FF69B4" : "#FF0000";
  ctx.fillRect(gameState.player.x, gameState.player.y, gameState.player.width, gameState.player.height);
}

function update() {
  if (gameState.inShop) return;
  const p = gameState.player;

  // Движение
  p.velX = 0;
  if (gameState.keys["ArrowLeft"] || gameState.keys["a"]) p.velX = -p.speed;
  if (gameState.keys["ArrowRight"] || gameState.keys["d"]) p.velX = p.speed;

  // Прыжок
  if (gameState.keys["ArrowUp"] || gameState.keys[" "] || gameState.keys["w"]) {
    if (p.grounded) {
      p.velY = -p.jumpPower;
      p.grounded = false;
      p.jumpsUsed = p.doubleJump ? 1 : 0;
    } else if (p.doubleJump && p.jumpsUsed > 0) {
      p.velY = -p.jumpPower * 0.8;
      p.jumpsUsed--;
    }
  }

  // Гравитация
  p.velY += gameState.gravity;
  p.y += p.velY;
  p.x += p.velX;

  // Коллизии
  p.grounded = false;
  gameState.platforms.forEach(platform => {
    if (
      p.x < platform.x + platform.w &&
      p.x + p.width > platform.x &&
      p.y + p.height > platform.y &&
      p.y + p.height < platform.y + platform.h &&
      p.velY > 0
    ) {
      p.y = platform.y - p.height;
      p.velY = 0;
      p.grounded = true;
      p.jumpsUsed = p.doubleJump ? 1 : 0;
    }
  });

  // Сбор монет
  gameState.coins = gameState.coins.filter(coin => {
    const dx = p.x + 16 - coin.x - 8;
    const dy = p.y + 16 - coin.y - 8;
    if (Math.hypot(dx, dy) < 25) {
      gameState.coinsCollected++;
      autoSave();
      updateUI();
      return false;
    }
    return true;
  });

  // Враги
  gameState.enemies.forEach(e => {
    e.x += e.dir * e.speed;
    if (e.x < 100 || e.x > 700) e.dir *= -1;

    if (
      p.x < e.x + e.width &&
      p.x + p.width > e.x &&
      p.y < e.y + e.height &&
      p.y + p.height > e.y
    ) {
      p.hp--;
      if (p.hp <= 0) {
        if (confirm("💀 Game Over!\nНачать с начала уровня?")) {
          p.hp = p.maxHp;
          p.x = 50;
          p.y = 300;
        }
      }
      p.velY = -8;
    }
  });

  // Новый уровень
  if (gameState.coins.length === 0) {
    gameState.level++;
    generateLevel(gameState.level);
    p.x = 50;
    p.y = 300;
    p.hp = p.maxHp;
    autoSave();
    updateUI();
  }
}

function gameLoop() {
  update();
  draw();
  requestAnimationFrame(gameLoop);
}

// =============== МАГАЗИН ===============
const UPGRADES = {
  jump: {
    name: "🦘 Выше прыжок",
    desc: "+2 к силе прыжка",
    cost: (upg) => 30 + (upg.jumpPower - 12) * 2,
    apply: (upg) => { upg.jumpPower += 2; }
  },
  doubleJump: {
    name: "🔄 Двойной прыжок",
    desc: "Прыгайте в воздухе!",
    cost: () => 80,
    apply: (upg) => { upg.doubleJump = true; }
  },
  speed: {
    name: "🏃 Быстрее бег",
    desc: "+1 к скорости",
    cost: (upg) => 25 + (upg.speed - 5) * 3,
    apply: (upg) => { upg.speed += 1; }
  },
  hp: {
    name: "❤️ +1 HP",
    desc: "Увеличить здоровье",
    cost: (upg) => 50 + (upg.maxHp - 3) * 10,
    apply: (upg) => { upg.maxHp += 1; }
  }
};

function openShop() {
  gameState.inShop = true;
  const panel = document.createElement("div");
  panel.id = "shop-panel";
  panel.innerHTML = '<h3>🏪 Магазин улучшений</h3><div class="upgrades"></div><button class="back-btn">◀️ Назад</button>';
  document.getElementById("game-container").appendChild(panel);

  const upgradesDiv = panel.querySelector(".upgrades");
  Object.entries(UPGRADES).forEach(([key, upg]) => {
    const cost = upg.cost(gameState.player);
    const disabled = gameState.coinsCollected < cost ? 'disabled' : '';
    const owned = key === "doubleJump" && gameState.player.doubleJump 
      || key === "jump" && gameState.player.jumpPower > 12
      || key === "speed" && gameState.player.speed > 5
      || key === "hp" && gameState.player.maxHp > 3;
    
    const btnText = owned ? "✅ Куплено" : `${cost}💰`;
    upgradesDiv.innerHTML += `
      <div class="upgrade-item">
        <strong>${upg.name}</strong><br>
        <small>${upg.desc}</small><br>
        <button ${disabled} onclick="buy('${key}')">${btnText}</button>
      </div>
    `;
  });

  panel.querySelector(".back-btn").onclick = () => {
    gameState.inShop = false;
    panel.remove();
  };
}

window.buy = function(key) {
  const upg = UPGRADES[key];
  const cost = upg.cost(gameState.player);
  if (gameState.coinsCollected >= cost) {
    upg.apply(gameState.player);
    gameState.coinsCollected -= cost;
    if (key === "hp") gameState.player.hp = gameState.player.maxHp;
    autoSave();
    updateUI();
    openShop(); // обновить магазин
  }
};

// =============== РЕЙТИНГ ===============
async function showLeaderboard() {
  gameState.inShop = true;
  const panel = document.createElement("div");
  panel.id = "rank-panel";
  panel.innerHTML = `
    <h3>🏆 Топ-10</h3>
    <div id="rank-list">Загрузка...</div>
    <button class="back-btn">◀️ Назад</button>
  `;
  document.getElementById("game-container").appendChild(panel);

  // Отправляем запрос
  const msgId = Date.now();
  let resp = null;
  const handler = (e) => {
    if (e.data?.source === "telegram" && e.data?.type === "leaderboard_resp" && e.data.id === msgId) {
      resp = e.data.data;
      showList(resp);
    }
  };
  window.addEventListener("message", handler);
  setTimeout(() => window.removeEventListener("message", handler), 3000);

  tg.sendData(JSON.stringify({ type: "request_leaderboard", id: msgId }));

  const showList = (top) => {
    const listEl = panel.querySelector("#rank-list");
    if (!top || top.length === 0) {
      listEl.innerHTML = "📭 Нет данных";
      return;
    }

    let html = "";
    const medals = ["🥇", "🥈", "🥉", "4", "5", "6", "7", "8", "9", "10"];
    top.forEach((p, i) => {
      let name = p.username || `user${p.user_id}`;
      if (name.length > 12) name = name.substring(0, 10) + "..";
      const isMe = p.user_id === userId;
      const style = isMe ? "background:#333;border-left:3px solid #00ff00" : "";
      html += `<div style="${style}"><strong>${medals[i] || (i+1)}.</strong> ${name} — Ур.${p.level}, ${p.coins}💰${isMe ? " ← 🟢" : ""}</div>`;
    });
    listEl.innerHTML = html;
  };

  panel.querySelector(".back-btn").onclick = () => {
    gameState.inShop = false;
    panel.remove();
  };
};

// =============== АВТОСОХРАНЕНИЕ ===============
let lastSave = 0;
function autoSave() {
  const now = Date.now();
  if (now - lastSave < 3000) return; // не чаще 3 сек
  lastSave = now;

  const saveData = {
    coins: gameState.coinsCollected,
    level: gameState.level,
    upgrades: {
      jumpPower: gameState.player.jumpPower,
      doubleJump: gameState.player.doubleJump,
      speed: gameState.player.speed,
      maxHp: gameState.player.maxHp
    }
  };

  saveLocal(saveData);
  saveToCloud(saveData);
}

// =============== СТАРТ ===============
function chooseSave() {
  const local = loadLocalSave();
  const container = document.getElementById("game-container");
  container.innerHTML = `
    <div style="color:white;text-align:center;padding:30px;font-family:'Press Start 2P';font-size:14px">
      <h2>👾 Марио приключение</h2>
      ${local 
        ? `<p>💾 Локальное: Ур.${local.level}, ${local.coins}💰</p>
           <button onclick="useSave('local')" class="choice-btn">💾 Загрузить</button>` 
        : `<p>🆕 Начать новую игру</p>`
      }
      <button onclick="useSave('new')" class="choice-btn">${local ? "🆕 Новая" : "▶️ Играть"}</button>
    </div>
    <style>.choice-btn{display:block;margin:10px auto;padding:10px 20px;background:#FFD700;border:none;border-radius:4px;cursor:pointer;font-family:inherit}</style>
  `;
}

window.useSave = function(source) {
  let saveData;
  if (source === "local") {
    saveData = loadLocalSave();
  } else {
    saveData = {
      coins: 0,
      level: 1,
      upgrades: {
        jumpPower: 12,
        doubleJump: false,
        speed: 5,
        maxHp: 3
      }
    };
  }
  initGame(saveData);
};

// Запуск
chooseSave();