const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Kritik hata koruması
process.on('uncaughtException', (err) => console.error('Sistem Hatası:', err));
process.on('unhandledRejection', (r) => console.error('Sistem Reddi:', r));

let sessions = {};
const getS = (sid) => {
    if (!sessions[sid]) sessions[sid] = { bots: {}, logs: {}, cfgs: {}, spams: {} };
    return sessions[sid];
};

function startBot(sid, host, port, user, ver, auto) {
    const s = getS(sid);
    if (s.bots[user]) return;

    const finalPort = parseInt(port) || 25565;
    s.logs[user] = s.logs[user] || [];
    s.cfgs[user] = { auto: auto === 'true', host, port: finalPort, ver };

    try {
        const bot = mineflayer.createBot({
            host: host,
            port: finalPort,
            username: user,
            version: ver,
            auth: 'offline',
            checkTimeoutInterval: 90000, // Daha esnek bağlantı
            keepAlive: true,
            hideErrors: true
        });

        // Pluginleri Yükle
        bot.loadPlugin(pathfinder);
        s.bots[user] = bot;

        bot.on('inject_allowed', () => {
            const mcData = require('minecraft-data')(bot.version);
            const movements = new Movements(bot, mcData);
            // Akıllı yol bulma ayarları (blok kırma/koyma kapalı, sadece yürüme/zıplama)
            movements.canDig = false;
            movements.allowSprinting = true;
            bot.pathfinder.setMovements(movements);
        });

        // --- İNSANSI ANTİ-AFK (GELİŞMİŞ SÜRÜM) ---
        function humanBehavior() {
            if (!bot.entity) return;
            const rand = Math.random();
            if (rand < 0.6) {
                // Etrafa bakış
                bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.4);
            } else if (rand < 0.9) {
                // Sadece zıpla
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 150);
            } else {
                // Sneak yap/bırak (çömelme)
                bot.setControlState('sneak', true);
                setTimeout(() => bot.setControlState('sneak', false), 1000);
            }
            // 30 saniye ile 100 saniye arası rastgele tekrar
            setTimeout(humanBehavior, 30000 + Math.random() * 70000);
        }
        setTimeout(humanBehavior, 20000);

        // --- 2000 SATIRLIK KALICI VE RENKLİ LOG SİSTEMİ ---
        bot.on('message', (jsonMsg) => {
            const time = new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'});
            try {
                const html = jsonMsg.toHTML();
                s.logs[user].push(`<small style="color:#8b949e">[${time}]</small> ${html}`);
            } catch (e) {
                s.logs[user].push(`<small style="color:#8b949e">[${time}]</small> <span>${jsonMsg.toString()}</span>`);
            }
            if (s.logs[user].length > 2000) s.logs[user].shift();
        });

        bot.on('login', () => s.logs[user].push("<b style='color:#2ecc71'>[SİSTEM] Sunucuya başarıyla girildi.</b>"));
        bot.on('spawn', () => s.logs[user].push("<b style='color:#3498db'>[DÜNYA] Karakter hazır.</b>"));
        
        bot.on('end', (reason) => {
            const reconnect = s.cfgs[user]?.auto;
            delete s.bots[user];
            s.logs[user].push(`<b style='color:#e67e22'>[UYARI] Bağlantı kesildi: ${reason}</b>`);
            if (reconnect) {
                s.logs[user].push("<b style='color:#f1c40f'>[OTO] 15 saniye içinde tekrar bağlanılıyor...</b>");
                setTimeout(() => startBot(sid, host, finalPort, user, ver, 'true'), 15000);
            }
        });

        bot.on('error', (err) => {
            if (!err.message.includes('ECONNRESET')) {
                s.logs[user].push(`<b style='color:#e74c3c'>[HATA] ${err.message}</b>`);
            }
        });

    } catch (err) {
        console.log("Bot başlatma hatası:", err);
    }
}

// HTTP API Sunucusu
http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const q = parsed.query, p = parsed.pathname, s = getS(q.sid);
    const b = s.bots[q.user];

    try {
        if (p === '/start') { startBot(q.sid, q.host, q.port, q.user, q.ver, q.auto); return res.end("1"); }
        if (p === '/stop') { if(b) { s.cfgs[q.user].auto = false; b.quit(); } return res.end("1"); }
        if (p === '/send') { 
            const msg = decodeURIComponent(q.msg);
            if (msg.startsWith('/goto') && b) {
                const parts = msg.split(' ');
                const goal = new goals.GoalBlock(parseInt(parts[1]), parseInt(parts[2]), parseInt(parts[3]));
                b.pathfinder.setGoal(goal);
            } else if (b) b.chat(msg);
            return res.end("1"); 
        }
        if (p === '/move') { if(b) b.setControlState(q.dir, q.state === 'true'); return res.end("1"); }
        if (p === '/drop') {
            if (b && b.inventory) {
                const item = b.inventory.slots[parseInt(q.slot)];
                if (item) b.tossStack(item).catch(() => {});
            }
            return res.end("1");
        }
        if (p === '/data') {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({
                active: Object.keys(s.bots),
                logs: s.logs,
                botData: b ? { 
                    hp: b.health, food: b.food, 
                    inv: b.inventory ? b.inventory.slots.map((i, idx) => i ? {name: i.name, count: i.count, slot: idx} : null).filter(x => x) : []
                } : null
            }));
        }
    } catch(e) { console.error("API Hatası:", e); }

    let f = path.join(__dirname, p === '/' ? 'index.html' : p);
    fs.readFile(f, (err, data) => {
        if (err) return res.end("404");
        res.end(data);
    });
}).listen(process.env.PORT || 10000);
        
