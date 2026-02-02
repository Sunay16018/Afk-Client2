const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// --- HATA KALKANI (SİSTEMİN ÇÖKMESİNİ ENGELLER) ---
process.on('uncaughtException', (e) => console.log(' [Kritik Hata Yutuldu]:', e.message));
process.on('unhandledRejection', (e) => console.log(' [Promise Hatası Yutuldu]:', e.message));

let sessions = {};

// Kullanıcı verilerini ve logları hafızada tut
const getS = (sid) => {
    if (!sessions[sid]) sessions[sid] = { bots: {}, logs: {}, cfgs: {} };
    return sessions[sid];
};

function startBot(sid, host, port, user, ver, auto) {
    const s = getS(sid);
    if (s.bots[user]) return; // Zaten varsa tekrar başlatma

    // LOG EKLEME FONKSİYONU
    const log = (msg, color = "#8b949e") => {
        const time = new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit', second:'2-digit'});
        s.logs[user] = s.logs[user] || [];
        s.logs[user].push(`<div style="color:${color}; border-bottom:1px solid #21262d; padding:2px;">[${time}] ${msg}</div>`);
        if (s.logs[user].length > 3000) s.logs[user].shift(); // Hafıza şişmesin diye 3000 satır sınır
    };

    log(`<b>[BAŞLATILIYOR]</b> ${user} sunucuya bağlanıyor...`, "#58a6ff");

    try {
        const bot = mineflayer.createBot({
            host: host,
            port: parseInt(port) || 25565,
            username: user,
            version: ver,
            auth: 'offline',
            checkTimeoutInterval: 180000, // 3 Dakika! (Proxy geçişlerinde asla düşmez)
            keepAlive: true,
            hideErrors: true
        });

        bot.loadPlugin(pathfinder);
        s.bots[user] = bot;
        s.cfgs[user] = { auto: auto === 'true', host, port, ver };

        bot.on('inject_allowed', () => {
            const mcData = require('minecraft-data')(bot.version);
            const movements = new Movements(bot, mcData);
            movements.canDig = false; // Ban yememek için kazmayı kapat
            movements.allowSprinting = true;
            bot.pathfinder.setMovements(movements);
        });

        // --- ULTRA GELİŞMİŞ "HAYALET" ANTİ-AFK ---
        function humanBehavior() {
            if (!bot.entity) return;
            
            const action = Math.random();
            // %40 İhtimalle etrafa bak (Head Rotation)
            if (action < 0.4) {
                const yaw = Math.random() * Math.PI * 2;
                const pitch = (Math.random() - 0.5) * 0.5;
                bot.look(yaw, pitch, false);
            } 
            // %30 İhtimalle Zıpla
            else if (action < 0.7) {
                bot.setControlState('jump', true);
                setTimeout(() => bot.setControlState('jump', false), 250);
            } 
            // %20 İhtimalle Eğil/Kalk (Sneak) - Bu en güvenlisidir
            else if (action < 0.9) {
                bot.setControlState('sneak', true);
                setTimeout(() => bot.setControlState('sneak', false), 1500);
            } 
            // %10 İhtimalle El Salla (Swing Arm)
            else {
                bot.swingArm('right');
            }

            // Bir sonraki hareket 30sn ile 90sn arasında rastgele bir zamanda
            // Sabit süre olmadığı için bot korumaları algılayamaz.
            setTimeout(humanBehavior, 30000 + Math.random() * 60000);
        }
        
        bot.on('spawn', () => {
            log("<b>[GİRİŞ]</b> Dünya yüklendi, Anti-AFK aktif.", "#238636");
            setTimeout(humanBehavior, 10000); // 10sn sonra başla
        });

        bot.on('message', (json) => {
            try { log(json.toHTML(), "#c9d1d9"); } 
            catch { log(json.toString(), "#c9d1d9"); }
        });

        bot.on('kicked', (reason) => log(`<b>[ATILDI]</b> Sebep: ${reason}`, "#da3633"));
        
        bot.on('error', (err) => {
            log(`<b>[HATA]</b> Ağ hatası: ${err.message}`, "#da3633");
            // Hata olsa bile 'end' tetikleneceği için reconnect orada çalışır
        });

        bot.on('end', (reason) => {
            const reconnect = s.cfgs[user]?.auto;
            delete s.bots[user];
            log(`<b>[BAĞLANTI KOPTU]</b> ${reason}`, "#d29922");
            
            if (reconnect) {
                log(`<b>[OTO-TEKRAR]</b> 15 saniye içinde yeniden bağlanılıyor...`, "#58a6ff");
                setTimeout(() => startBot(sid, host, port, user, ver, 'true'), 15000);
            }
        });

    } catch (e) {
        log(`<b>[SİSTEM HATASI]</b> Bot başlatılamadı: ${e.message}`, "red");
    }
}

// --- WEB SUNUCUSU ---
http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const q = parsed.query, p = parsed.pathname, s = getS(q.sid);
    const b = s.bots[q.user];

    // API Endpointleri
    if (p === '/start') { startBot(q.sid, q.host, q.port, q.user, q.ver, q.auto); return res.end("OK"); }
    if (p === '/stop') { if(b) { s.cfgs[q.user].auto = false; b.quit(); } return res.end("OK"); }
    if (p === '/send') { if(b) b.chat(decodeURIComponent(q.msg)); return res.end("OK"); }
    if (p === '/goto') { 
        if(b) {
            const goal = new goals.GoalBlock(parseInt(q.x), parseInt(q.y), parseInt(q.z));
            b.pathfinder.setGoal(goal);
        }
        return res.end("OK"); 
    }
    if (p === '/drop') {
        if(b) {
            const item = b.inventory.slots[parseInt(q.slot)];
            if(item) b.tossStack(item);
        }
        return res.end("OK");
    }
    if (p === '/data') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
            active: Object.keys(s.bots),
            logs: s.logs,
            botData: b ? { 
                hp: b.health, food: b.food, 
                inv: b.inventory.slots.map((i, idx) => i ? {name: i.name, count: i.count, slot: idx} : null).filter(x => x)
            } : null
        }));
    }

    // HTML Dosyasını Oku
    fs.readFile(path.join(__dirname, p === '/' ? 'index.html' : p), (err, data) => {
        if (err) return res.end("404 Not Found");
        res.end(data);
    });

}).listen(process.env.PORT || 10000);
    
