const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Sunucu tarafında hata ayıklama ve sistem çökmesini engelleme
process.on('uncaughtException', (err) => console.error('SİSTEM KRİTİK HATA:', err));
process.on('unhandledRejection', (reason) => console.error('SİSTEM REDDİ:', reason));

let sessions = {};
const getS = (sid) => {
    if (!sessions[sid]) sessions[sid] = { bots: {}, logs: {}, cfgs: {}, errors: {} };
    return sessions[sid];
};

function startBot(sid, host, port, user, ver, auto) {
    const s = getS(sid);
    if (s.bots[user]) return;

    const bot = mineflayer.createBot({
        host, port: parseInt(port) || 25565, username: user, version: ver, auth: 'offline',
        checkTimeoutInterval: 150000, // 2.5 Dakika! En üst düzey Proxy toleransı.
        keepAlive: true,
        hideErrors: false, // Hataları gizleme, analiz etmemiz lazım
        closeTimeout: 60000
    });

    bot.loadPlugin(pathfinder);
    s.bots[user] = bot;
    s.logs[user] = s.logs[user] || [];
    s.cfgs[user] = { auto: auto === 'true', host, port, ver };

    bot.on('inject_allowed', () => {
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);
        movements.canDig = false;
        movements.allowSprinting = true;
        bot.pathfinder.setMovements(movements);
    });

    // --- ULTRA İNSANSI ANTİ-AFK SİSTEMİ ---
    function advancedHumanBehavior() {
        if (!bot.entity) return;
        const actionRand = Math.random();
        
        if (actionRand < 0.5) {
            // İnsan gibi çevreye odaklanma (Yaw ve Pitch)
            bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.5, false);
        } else if (actionRand < 0.7) {
            // Rastgele zıplama
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 150);
        } else if (actionRand < 0.85) {
            // Shift (Sneak) ile gizlenme simülasyonu
            bot.setControlState('sneak', true);
            setTimeout(() => bot.setControlState('sneak', false), 1200);
        } else {
            // Elindeki eşyayı sallama (Sol tık simülasyonu)
            bot.swingArm('right');
        }
        
        // 40 saniye ile 110 saniye arası tamamen belirsiz aralıklar
        setTimeout(advancedHumanBehavior, 40000 + Math.random() * 70000);
    }
    setTimeout(advancedHumanBehavior, 20000);

    // --- TÜM HATALARI VE MESAJLARI YAKALAMA ---
    const addLog = (msg, color = "#c9d1d9") => {
        const time = new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit', second:'2-digit'});
        s.logs[user].push(`<div style="color:${color}"><small>[${time}]</small> ${msg}</div>`);
        if (s.logs[user].length > 2500) s.logs[user].shift();
    };

    bot.on('message', (json) => { try { addLog(json.toHTML()); } catch { addLog(json.toString()); } });
    
    bot.on('kicked', (reason) => addLog(`<b>[ATILDI]</b> Sunucudan atılma sebebi: ${reason}`, "#ff7b72"));
    bot.on('error', (err) => addLog(`<b>[HATA]</b> Bağlantı hatası: ${err.message}`, "#f85149"));
    
    // Teknik paket hatalarını oku
    bot._client.on('packet_exception', (err) => {
        addLog(`<b>[TEKNİK]</b> Sunucu paket hatası gönderdi: ${err.message}`, "#d2a8ff");
    });

    bot.on('end', (reason) => {
        const reconnect = s.cfgs[user]?.auto;
        delete s.bots[user];
        addLog(`<b>[SİSTEM]</b> Bağlantı sonlandı. Sebep: ${reason}`, "#e3b341");
        if (reconnect) {
            addLog(`<b>[RE-CONNECT]</b> 12 saniye sonra otomatik giriş yapılacak...`, "#58a6ff");
            setTimeout(() => startBot(sid, host, port, user, ver, 'true'), 12000);
        }
    });
}

// HTTP API ve WEB PANEL
http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const q = parsed.query, p = parsed.pathname, s = getS(q.sid);
    const b = s.bots[q.user];

    try {
        if (p === '/start') { startBot(q.sid, q.host, q.port, q.user, q.ver, q.auto); return res.end("OK"); }
        if (p === '/send') { if(b) b.chat(decodeURIComponent(q.msg)); return res.end("OK"); }
        if (p === '/goto') {
            if(b) {
                const goal = new goals.GoalBlock(parseInt(q.x), parseInt(q.y), parseInt(q.z));
                b.pathfinder.setGoal(goal);
                addLog(`<b>[NAV]</b> ${q.x}, ${q.y}, ${q.z} koordinatına gidiliyor...`, "#58a6ff");
            }
            return res.end("OK");
        }
        if (p === '/drop') {
            if (b) {
                const item = b.inventory.slots[parseInt(q.slot)];
                if (item) b.tossStack(item);
            }
            return res.end("OK");
        }
        if (p === '/data') {
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({
                active: Object.keys(s.bots), logs: s.logs,
                botData: b ? { 
                    hp: b.health, food: b.food, 
                    inv: b.inventory.slots.map((i, idx) => i ? {name: i.name, count: i.count, slot: idx} : null).filter(x => x)
                } : null
            }));
        }
    } catch(e) { console.error("API Hatası:", e); }

    fs.readFile(path.join(__dirname, p === '/' ? 'index.html' : p), (err, data) => res.end(data || "404"));
}).listen(process.env.PORT || 10000);
                       
