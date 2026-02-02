const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => console.error('Hata Filtrelendi:', err));

let sessions = {};
const getS = (sid) => {
    if (!sessions[sid]) sessions[sid] = { bots: {}, logs: {}, cfgs: {} };
    return sessions[sid];
};

function startBot(sid, host, port, user, ver, auto) {
    const s = getS(sid);
    if (s.bots[user]) return;

    const bot = mineflayer.createBot({
        host, port: parseInt(port), username: user, version: ver, auth: 'offline',
        checkTimeoutInterval: 120000, // 2 dakika! En sağlam duvar.
        keepAlive: true,
        hideErrors: true
    });

    bot.loadPlugin(pathfinder);
    s.bots[user] = bot;
    s.logs[user] = s.logs[user] || []; // Gece loglarını temizleme
    s.cfgs[user] = { auto: auto === 'true' };

    bot.on('inject_allowed', () => {
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);
        movements.canDig = false; // Etrafı kazıp ban yeme
        bot.pathfinder.setMovements(movements);
    });

    // --- EN İNSANSI ANTİ-AFK SİSTEMİ ---
    function humanBrain() {
        if (!bot.entity) return;
        const r = Math.random();
        
        if (r < 0.6) {
            // İnsan gibi yumuşak bakış
            bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.3);
        } else if (r < 0.8) {
            // Rastgele zıpla
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 200);
        } else {
            // Kısa süreli eğil (Sneak)
            bot.setControlState('sneak', true);
            setTimeout(() => bot.setControlState('sneak', false), 800);
        }
        // 30 saniye ile 100 saniye arası rastgele döngü
        setTimeout(humanBrain, 30000 + Math.random() * 70000);
    }
    setTimeout(humanBrain, 20000);

    // --- KALICI MESAJ SİSTEMİ (2000 SATIR) ---
    bot.on('message', (json) => {
        const time = new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'});
        let line;
        try { line = `[${time}] ${json.toHTML()}`; } 
        catch { line = `[${time}] ${json.toString()}`; }
        s.logs[user].push(line);
        if (s.logs[user].length > 2000) s.logs[user].shift();
    });

    bot.on('end', (reason) => {
        const reconnect = s.cfgs[user]?.auto;
        delete s.bots[user];
        if (reconnect) {
            s.logs[user].push(`<b style='color:orange'>[DUVAR] Bağlantı koptu (${reason}). 10sn sonra tekrar giriliyor...</b>`);
            setTimeout(() => startBot(sid, host, port, user, ver, 'true'), 10000);
        }
    });
}

http.createServer((req, res) => {
    const q = url.parse(req.url, true).query;
    const p = url.parse(req.url, true).pathname;
    const s = getS(q.sid);
    const b = s.bots[q.user];

    if (p === '/start') startBot(q.sid, q.host, q.port, q.user, q.ver, q.auto);
    if (p === '/send') { if(b) b.chat(decodeURIComponent(q.msg)); }
    if (p === '/goto') {
        if(b) b.pathfinder.setGoal(new goals.GoalBlock(parseInt(q.x), parseInt(q.y), parseInt(q.z)));
    }
    if (p === '/drop') {
        if (b) {
            const item = b.inventory.slots[parseInt(q.slot)];
            if (item) b.tossStack(item);
        }
    }
    if (p === '/data') {
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({
            active: Object.keys(s.bots), logs: s.logs,
            botData: b ? { hp: b.health, food: b.food, inv: b.inventory.slots.map((i, idx) => i ? {name: i.name, count: i.count, slot: idx} : null).filter(x => x) } : null
        }));
    }
    fs.readFile(path.join(__dirname, p === '/' ? 'index.html' : p), (err, data) => res.end(data || "404"));
}).listen(process.env.PORT || 10000);
           
