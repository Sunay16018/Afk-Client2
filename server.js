const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const autoEat = require('mineflayer-auto-eat').plugin;
const pvp = require('mineflayer-pvp').plugin;
const armorManager = require('mineflayer-armor-manager');
const collectBlock = require('mineflayer-collectblock').plugin;
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Çökme Engelleyici
process.on('uncaughtException', (e) => console.log(' [HATA YUTULDU]:', e.message));

let bots = {}; // Aktif botlar

// --- WEBSOCKET BAĞLANTISI ---
io.on('connection', (socket) => {
    console.log('Panel bağlandı:', socket.id);

    // Bot Başlatma İsteği
    socket.on('startBot', (data) => {
        if (bots[data.user]) return; // Zaten varsa açma
        createBot(data, socket);
    });

    // Botu Öldür/Kapat
    socket.on('stopBot', (user) => {
        if (bots[user]) {
            bots[user].cfg.auto = false; // Yeniden girmesin
            bots[user].quit();
            delete bots[user];
            io.emit('botList', Object.keys(bots));
        }
    });

    // Chat Mesajı
    socket.on('chat', (data) => {
        if (bots[data.user]) bots[data.user].chat(data.msg);
    });

    // Hareket Komutları
    socket.on('move', (data) => {
        const b = bots[data.user];
        if (b) {
            b.pathfinder.setGoal(null); // Otoyürüyüşü iptal et
            b.setControlState(data.dir, data.state);
        }
    });

    // Spam Başlat/Durdur
    socket.on('spam', (data) => {
        const b = bots[data.user];
        if (!b) return;
        if (data.state) {
            if (b.spamTask) clearInterval(b.spamTask);
            b.spamTask = setInterval(() => {
                b.chat(data.msg + " " + Math.floor(Math.random() * 999));
            }, data.delay);
        } else {
            if (b.spamTask) clearInterval(b.spamTask);
        }
    });

    // Goto (Koordinat)
    socket.on('goto', (data) => {
        const b = bots[data.user];
        if (b) {
            const goal = new goals.GoalBlock(Number(data.x), Number(data.y), Number(data.z));
            b.pathfinder.setGoal(goal);
        }
    });
    
    // Envanter Drop
    socket.on('drop', (data) => {
        const b = bots[data.user];
        if (b && b.inventory.slots[data.slot]) {
            b.tossStack(b.inventory.slots[data.slot]);
        }
    });
});

// --- BOT OLUŞTURMA FONKSİYONU ---
function createBot(cfg, socket) {
    const bot = mineflayer.createBot({
        host: cfg.host,
        port: parseInt(cfg.port),
        username: cfg.user,
        version: cfg.ver,
        auth: 'offline',
        checkTimeoutInterval: 120000, // 2 Dakika
        keepAlive: true,
        hideErrors: true
    });

    // Pluginleri Yükle
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(autoEat);
    bot.loadPlugin(pvp);
    bot.loadPlugin(armorManager);
    bot.loadPlugin(collectBlock);

    // Bot Ayarlarını Kaydet
    bot.cfg = cfg;
    bots[cfg.user] = bot;
    io.emit('botList', Object.keys(bots));

    const log = (msg, color = '#8b949e') => {
        const time = new Date().toLocaleTimeString('tr-TR');
        io.emit('log', { user: cfg.user, html: `<div style="color:${color}; border-bottom:1px solid #333;">[${time}] ${msg}</div>` });
    };

    bot.once('spawn', () => {
        log('Sunucuya giriş yapıldı. God Mode modüller yükleniyor...', '#2ecc71');
        
        // Hareket Ayarları
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);
        movements.canDig = false;
        movements.allowSprinting = true;
        movements.allowParkour = true;
        bot.pathfinder.setMovements(movements);

        // Auto Eat Ayarları
        bot.autoEat.options = { priority: 'foodPoints', startAt: 15, bannedFood: [] };
        
        // Armor Manager (Otomatik Zırh Giy)
        bot.armorManager.equipAll();

        // İnsansı Anti-AFK
        startAntiAfk(bot);
    });

    // Eventler
    bot.on('autoeat_started', () => log('Otomatik yemek yeniyor...', '#f1c40f'));
    bot.on('playerCollect', (collector, item) => { if(collector === bot.entity) log('Eşya toplandı.', '#58a6ff'); });
    bot.on('kicked', (reason) => log(`Atıldı: ${reason}`, '#da3633'));
    bot.on('message', (m) => log(m.toHTML ? m.toHTML() : m.toString()));
    
    // ÖLÜNCE YENİDEN DOĞ
    bot.on('death', () => {
        log('Bot öldü! Yeniden doğuluyor...', '#da3633');
        // Mineflayer otomatik respawn atar genelde ama biz garantiye alalım
    });

    // PVP: Biri vurursa karşılık ver (Basit Koruma)
    bot.on('onCorrelateAttack', (attacker, victim, weapon) => {
        if (victim === bot.entity) {
            bot.pvp.attack(attacker);
        }
    });

    // BAĞLANTI KOPARSA (RECONNECT)
    bot.on('end', (reason) => {
        log(`Bağlantı koptu: ${reason}`, '#da3633');
        delete bots[cfg.user];
        io.emit('botList', Object.keys(bots));

        if (cfg.auto) {
            log('10 saniye içinde tekrar bağlanılıyor...', '#e67e22');
            setTimeout(() => createBot(cfg, socket), 10000);
        }
    });
    
    bot.on('error', (err) => log(`Hata: ${err.message}`, '#da3633'));
}

// İnsansı Anti-AFK
function startAntiAfk(bot) {
    if(!bot.entity) return;
    const r = Math.random();
    if(r < 0.5) bot.look(Math.random()*6.28, (Math.random()-0.5)*0.5);
    else if(r < 0.8) { bot.setControlState('jump', true); setTimeout(()=>bot.setControlState('jump', false), 250); }
    else { bot.swingArm('right'); }
    setTimeout(() => startAntiAfk(bot), 20000 + Math.random()*40000);
}

// Canlı Veri Akışı (Her saniye panele data basar)
setInterval(() => {
    let dataPack = {};
    for (let user in bots) {
        const b = bots[user];
        if (b && b.entity) {
            dataPack[user] = {
                hp: b.health,
                food: b.food,
                pos: b.entity.position,
                inv: b.inventory.slots.map((i, idx) => i ? {name: i.name, count: i.count, slot: idx} : null).filter(x => x)
            };
        }
    }
    io.emit('botData', dataPack);
}, 1000);

// Web Sunucusu
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
server.listen(process.env.PORT || 10000, () => console.log('GOD MODE Server Aktif!'));
                        
