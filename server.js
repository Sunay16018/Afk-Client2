const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => console.error('Hata:', err));
process.on('unhandledRejection', (r) => console.error('Red:', r));

let sessions = {};
const getS = (sid) => {
    if (!sessions[sid]) sessions[sid] = { bots: {}, logs: {}, cfgs: {}, spams: {} };
    return sessions[sid];
};

function startBot(sid, host, port, user, ver, auto) {
    const s = getS(sid);
    if (s.bots[user]) return;

    const bot = mineflayer.createBot({
        host, port: parseInt(port) || 25565, username: user, version: ver, auth: 'offline',
        checkTimeoutInterval: 60000, keepAlive: true, hideErrors: true
    });

    bot.loadPlugin(pathfinder);
    s.bots[user] = bot;
    if (!s.logs[user]) s.logs[user] = [];
    s.cfgs[user] = { auto: auto === 'true' };

    bot.on('inject_allowed', () => {
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);
        bot.pathfinder.setMovements(movements);
    });

    // --- İNSANSI ANTİ-AFK (SADECE BAKIŞ VE ZIPLAMA) ---
    function humanBehavior() {
        if (!bot.entity) return;
        const chance = Math.random();
        if (chance < 0.7) { 
            bot.look(Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.4);
        } else {
            bot.setControlState('jump', true);
            setTimeout(() => bot.setControlState('jump', false), 150);
        }
        setTimeout(humanBehavior, 20000 + Math.random() * 60000);
    }
    setTimeout(humanBehavior, 15000);

    // --- KALICI RENKLİ GECE LOGLARI ---
    bot.on('message', (json) => {
        let time = new Date().toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'});
        let entry;
        try { 
            entry = `<small style="color:#6e7681">[${time}]</small> ${json.toHTML()}`;
        } catch { 
            entry = `<small style="color:#6e7681">[${time}]</small> <span>${json.toString()}</span>`;
        }
        s.logs[user].push(entry);
        if (s.logs[user].length > 2000) s.logs[user].shift();
    });

    bot.on('login', () => s.logs[user].push("<b style='color:#2ecc71'>[SİSTEM] Giriş başarılı.</b>"));
    
    bot.on('end', () => {
        const reconnect = s.cfgs[user]?.auto;
        delete s.bots[user];
        if (reconnect) {
            s.logs[user].push("<b style='color:#f1c40f'>[PROXY] Bağlantı bitti, 10sn içinde tekrar giriliyor...</b>");
            setTimeout(() => startBot(sid, host, port, user, ver, 'true'), 10000);
        }
    });
}

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
                const [, x, y, z] = msg.split(' ');
                b.pathfinder.setGoal(new goals.GoalBlock(x, y, z));
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
                active: Object.keys(s.bots), logs: s.logs,
                botData: b ? { 
                    hp: b.health, food: b.food, 
                    inv: b.inventory ? b.inventory.slots.map((i, idx) => i ? {name: i.name, count: i.count, slot: idx} : null).filter(x => x) : []
                } : null
            }));
        }
    } catch(e) {}

    fs.readFile(path.join(__dirname, p === '/' ? 'index.html' : p), (err, data) => res.end(data || "404"));
}).listen(process.env.PORT || 10000);
                
