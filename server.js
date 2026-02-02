const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Sistem çökmelerini engelle ama logla
process.on('uncaughtException', (e) => console.log('[SİSTEM]:', e.message));
process.on('unhandledRejection', (e) => console.log('[RED]:', e.message));

let sessions = {};
const getS = (sid) => {
    if (!sessions[sid]) sessions[sid] = { bots: {}, logs: {}, cfgs: {} };
    return sessions[sid];
};

function startBot(sid, host, port, user, ver, auto) {
    const s = getS(sid);
    if (s.bots[user]) return;

    // --- ESKİ SAĞLAM PROXY AYARLARI ---
    const bot = mineflayer.createBot({
        host: host,
        port: parseInt(port) || 25565,
        username: user,
        version: ver,
        auth: 'offline',
        checkTimeoutInterval: 90000, // 90 Saniye (En stabil ayar budur)
        keepAlive: true,             // Bağlantıyı canlı tut
        hideErrors: true
    });

    bot.loadPlugin(pathfinder);
    s.bots[user] = bot;
    s.logs[user] = s.logs[user] || [];
    s.cfgs[user] = { auto: auto === 'true', host, port, ver };

    const log = (msg, color = "#8b949e") => {
        const time = new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
        s.logs[user].push(`<div style="color:${color}; border-bottom:1px solid #21262d;">[${time}] ${msg}</div>`);
        if (s.logs[user].length > 2000) s.logs[user].shift();
    };

    bot.on('inject_allowed', () => {
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);
        movements.canDig = false;
        bot.pathfinder.setMovements(movements);
    });

    // --- ANTİ-AFK (İNSANSI) ---
    function humanIdle() {
        if (!bot.entity) return;
        const r = Math.random();
        if (r < 0.5) bot.look(Math.random()*6.28, (Math.random()-0.5)*0.5); // Bakış
        else if (r < 0.8) { bot.setControlState('jump', true); setTimeout(()=>bot.setControlState('jump', false), 250); } // Zıpla
        else { bot.swingArm('right'); } // El salla
        setTimeout(humanIdle, 30000 + Math.random() * 60000);
    }
    
    bot.on('spawn', () => {
        log("<b>[GİRİŞ]</b> Sunucuya girildi.", "#2ecc71");
        setTimeout(humanIdle, 15000);
    });

    bot.on('message', (json) => {
        try { log(json.toHTML()); } catch { log(json.toString()); }
    });

    bot.on('end', (reason) => {
        const reconnect = s.cfgs[user]?.auto;
        delete s.bots[user];
        log(`<b>[KOPTU]</b> ${reason}`, "#e74c3c");
        if (reconnect) {
            log("<b>[OTO]</b> 10sn sonra tekrar bağlanılıyor...", "#f1c40f");
            setTimeout(() => startBot(sid, host, port, user, ver, 'true'), 10000);
        }
    });

    bot.on('error', (err) => log(`[HATA] ${err.message}`, "#e74c3c"));
}

http.createServer((req, res) => {
    const q = url.parse(req.url, true).query;
    const p = url.parse(req.url, true).pathname;
    const s = getS(q.sid);
    const b = s.bots[q.user];

    if (p === '/start') { startBot(q.sid, q.host, q.port, q.user, q.ver, q.auto); return res.end("OK"); }
    if (p === '/send') { if(b) b.chat(decodeURIComponent(q.msg)); return res.end("OK"); }
    if (p === '/goto') { 
        if(b) b.pathfinder.setGoal(new goals.GoalBlock(parseInt(q.x), parseInt(q.y), parseInt(q.z)));
        return res.end("OK"); 
    }
    if (p === '/drop') {
        if(b && b.inventory.slots[parseInt(q.slot)]) b.tossStack(b.inventory.slots[parseInt(q.slot)]);
        return res.end("OK");
    }
    if (p === '/data') {
        res.setHeader('Content-Type', 'application/json');
        // Kordinat verisi burada ekleniyor (pos)
        const pos = b && b.entity ? b.entity.position : null;
        return res.end(JSON.stringify({
            active: Object.keys(s.bots),
            logs: s.logs,
            botData: b ? { 
                hp: b.health, 
                food: b.food,
                pos: pos ? {x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z)} : null,
                inv: b.inventory.slots.map((i, idx) => i ? {name: i.name, count: i.count, slot: idx} : null).filter(x => x)
            } : null
        }));
    }

    fs.readFile(path.join(__dirname, p === '/' ? 'index.html' : p), (err, data) => res.end(data || "404"));
}).listen(process.env.PORT || 10000);
