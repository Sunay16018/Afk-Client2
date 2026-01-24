const mineflayer = require('mineflayer');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

let userSessions = {}; 

function getSession(sid) {
    if (!userSessions[sid]) userSessions[sid] = { bots: {}, logs: {}, configs: {} };
    return userSessions[sid];
}

function startBot(sid, host, user, ver) {
    const s = getSession(sid);
    if (s.bots[user]) return;

    const [ip, port] = host.split(':');
    s.logs[user] = ["<b style='color:gray'>[SİSTEM] Başlatılıyor...</b>"];

    const bot = mineflayer.createBot({
        host: ip, port: parseInt(port) || 25565, 
        username: user, version: ver, auth: 'offline'
    });

    s.bots[user] = bot;
    s.configs[user] = { msgT: null, afkT: null };

    bot.on('login', () => s.logs[user].push("<b style='color:#2ecc71'>[GİRİŞ] " + user + " oyuna girdi!</b>"));
    
    bot.on('message', (m) => {
        s.logs[user].push(m.toHTML());
        if(s.logs[user].length > 100) s.logs[user].shift();
    });

    // BOT DÜŞÜNCE TEMİZLİK VE UYARI
    bot.on('end', () => {
        if(s.logs[user]) s.logs[user].push("<b style='color:#ff4757'>[BAĞLANTI] Bağlantı kesildi.</b>");
        delete s.bots[user];
    });

    bot.on('kicked', (reason) => {
        s.logs[user].push("<b style='color:#ff4757'>[ATILDI] Sunucu bağlantıyı kesti.</b>");
        delete s.bots[user];
    });

    bot.on('error', (e) => { 
        s.logs[user].push("<b style='color:#ff4757'>[HATA] " + e.message + "</b>"); 
        delete s.bots[user]; 
    });
}

http.createServer((req, res) => {
    const q = url.parse(req.url, true).query;
    const p = url.parse(req.url, true).pathname;
    const sid = q.sid;
    if (!sid && p !== '/') return res.end("No SID");

    const s = getSession(sid);
    const bot = s.bots[q.user];

    if (p === '/start') { startBot(sid, q.host, q.user, q.ver); return res.end("ok"); }
    if (p === '/stop' && bot) { bot.quit(); delete s.bots[q.user]; return res.end("ok"); }
    if (p === '/send' && bot) { bot.chat(decodeURIComponent(q.msg)); return res.end("ok"); }
    
    if (p === '/update' && bot) {
        const conf = s.configs[q.user];
        if (q.type === 'inv' && q.status === 'drop') {
            const item = bot.inventory.slots[q.val];
            if (item) bot.tossStack(item);
        } else if (q.type === 'msg') {
            clearInterval(conf.msgT);
            if (q.status === 'on') conf.msgT = setInterval(() => bot.chat(decodeURIComponent(q.val)), q.sec * 1000);
        }
        return res.end("ok");
    }

    if (p === '/data' && sid) {
        const active = Object.keys(s.bots);
        const botData = {};
        if (q.user && s.bots[q.user]) {
            const b = s.bots[q.user];
            botData[q.user] = {
                hp: b.health || 0,
                food: b.food || 0,
                inv: b.inventory.slots.map((i, idx) => i ? {
                    name: i.name, count: i.count, slot: idx, 
                    display: i.displayName
                } : null).filter(x => x !== null)
            };
        }
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ active, logs: s.logs, botData }));
    }

    let f = path.join(__dirname, p === '/' ? 'index.html' : p);
    fs.readFile(f, (err, data) => res.end(data || "404"));
}).listen(process.env.PORT || 10000);
