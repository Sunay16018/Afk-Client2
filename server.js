const mineflayer = require('mineflayer');
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

    const finalPort = parseInt(port) || 25565;
    s.logs[user] = s.logs[user] || [];
    s.logs[user].push(`<b style='color:#3498db'>[SİSTEM] ${user} tüneli açılıyor...</b>`);
    
    s.cfgs[user] = { auto: auto === 'true', spamOn: false, host: host, port: finalPort, ver: ver };
    s.spams[user] = s.spams[user] || [];

    try {
        const bot = mineflayer.createBot({
            host: host, port: finalPort, username: user, version: ver, auth: 'offline',
            // --- PROXY GEÇİŞ DÜZELTMESİ ---
            checkTimeoutInterval: 60000, 
            hideErrors: true,
            keepAlive: true,
            closeTimeout: 60000, // Sunucu değiştirirken botun "asılı" kalmasını önler
            noPing: true // Proxy paket çakışmalarını azaltır
        });

        bot.setMaxListeners(0);
        s.bots[user] = bot;

        // --- RENKLİ CHAT (toHTML) ---
        bot.on('message', (jsonMsg) => {
            try {
                const html = jsonMsg.toHTML();
                if (html) {
                    s.logs[user].push(html);
                } else {
                    s.logs[user].push(`<span>${jsonMsg.toString()}</span>`);
                }
                if (s.logs[user].length > 250) s.logs[user].shift();
            } catch(e) {
                // Hata durumunda en azından düz metni kurtar (İsimler kaybolmaz)
                s.logs[user].push(`<span>${jsonMsg.toString()}</span>`);
            }
        });

        bot.on('login', () => s.logs[user].push("<b style='color:#2ecc71'>[BAĞLANTI] Lobi Girişi Başarılı.</b>"));
        
        // Sunucu değiştirme komutlarında botun "atılmasını" engelleyen tetikleyici
        bot.on('spawn', () => {
            s.logs[user].push("<b style='color:#f1c40f'>[DÜNYA] Yeni harita yüklendi (Proxy Aktarımı Tamam).</b>");
        });
        
        bot.on('end', (reason) => {
            const reconnect = s.cfgs[user]?.auto;
            delete s.bots[user];
            if (reconnect) {
                s.logs[user].push(`<b style='color:#f39c12'>[PROXY] Aktarım/Kopma algılandı. 5sn sonra geri dönülüyor...</b>`);
                setTimeout(() => startBot(sid, host, finalPort, user, ver, 'true'), 5000);
            }
        });

        bot.on('error', (err) => {
            // Proxy geçişlerindeki zararsız hataları logları kirletmemesi için süzüyoruz
            const ignore = ['array size', 'ECONNRESET', 'ETIMEDOUT'];
            if (!ignore.some(m => err.message.includes(m))) {
                s.logs[user].push(`<b style='color:#e74c3c'>[HATA] ${err.message}</b>`);
            }
        });
    } catch (e) { console.log(e); }
}

// Spam Motoru
setInterval(() => {
    Object.values(sessions).forEach(s => {
        Object.keys(s.bots).forEach(user => {
            if (s.cfgs[user]?.spamOn && s.bots[user]) {
                s.spams[user].forEach(item => {
                    if (Date.now() - item.last >= Math.max(1, item.delay) * 1000) {
                        try { s.bots[user].chat(item.msg); } catch(e) {}
                        item.last = Date.now();
                    }
                });
            }
        });
    });
}, 1000);

http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const q = parsed.query, p = parsed.pathname, s = getS(q.sid);

    try {
        if (p === '/start') { startBot(q.sid, q.host, q.port, q.user, q.ver, q.auto); return res.end("1"); }
        if (p === '/stop') { if(s.bots[q.user]) { s.cfgs[q.user].auto = false; s.bots[q.user].quit(); } return res.end("1"); }
        if (p === '/send') { if(s.bots[q.user]) s.bots[q.user].chat(decodeURIComponent(q.msg)); return res.end("1"); }
        if (p === '/move') { if(s.bots[q.user]) s.bots[q.user].setControlState(q.dir, q.state === 'true'); return res.end("1"); }
        if (p === '/tglspam') { s.cfgs[q.user].spamOn = (q.state === 'true'); return res.end("1"); }
        if (p === '/addspam') { s.spams[q.user].push({ id: Date.now(), msg: decodeURIComponent(q.msg), delay: parseInt(q.delay), last: 0 }); return res.end("1"); }
        if (p === '/delspam') { s.spams[q.user] = s.spams[q.user].filter(x => x.id != q.id); return res.end("1"); }
        if (p === '/drop') {
            const b = s.bots[q.user];
            if (b && b.inventory) {
                const item = b.inventory.slots[parseInt(q.slot)];
                if (item) b.tossStack(item).catch(() => {});
            }
            return res.end("1");
        }
        if (p === '/data') {
            const b = s.bots[q.user];
            const botData = b ? { 
                hp: b.health, food: b.food, 
                inv: b.inventory ? b.inventory.slots.map((i, idx) => i ? {name: i.name, count: i.count, slot: idx} : null).filter(x => x) : [],
                spams: s.spams[q.user], spamOn: s.cfgs[q.user].spamOn 
            } : null;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ active: Object.keys(s.bots), logs: s.logs, botData }));
        }
    } catch(e) {}

    let f = path.join(__dirname, p === '/' ? 'index.html' : p);
    fs.readFile(f, (err, data) => {
        if (err) return res.end("404");
        let mime = path.extname(f) === '.js' ? 'text/javascript' : 'text/html';
        res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
        res.end(data);
    });
}).listen(process.
