const mineflayer = require('mineflayer');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => console.error('Kritik Hata:', err));

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
    s.logs[user].push(`<b style='color:#3498db'>[SİSTEM] ${user} bağlanıyor...</b>`);
    
    s.cfgs[user] = { auto: auto === 'true', spamOn: false, host: host, port: finalPort, ver: ver };
    s.spams[user] = s.spams[user] || [];

    try {
        const bot = mineflayer.createBot({
            host: host, port: finalPort, username: user, version: ver, auth: 'offline',
            checkTimeoutInterval: 120000, hideErrors: true
        });

        bot.setMaxListeners(0);
        s.bots[user] = bot;

        // OYUNCU İSİMLERİNİ VE TÜM MESAJLARI YAKALAYAN GELİŞMİŞ SİSTEM
        bot.on('message', (jsonMsg) => {
            try {
                // Sunucu mesajlarını ve oyuncu chatini HTML formatında yakala
                let html = jsonMsg.toHTML();
                
                // Eğer toHTML boşsa veya eksikse ham metni al
                if (!html || html.length < 5) {
                    html = `<span>${jsonMsg.toString()}</span>`;
                }

                s.logs[user].push(html);
                if (s.logs[user].length > 200) s.logs[user].shift();
            } catch(e) {}
        });

        bot.on('login', () => s.logs[user].push("<b style='color:#2ecc71'>[BAĞLANTI] Başarılı!</b>"));
        
        bot.on('error', (err) => {
            if (!err.message.includes('array size')) {
                s.logs[user].push(`<b style='color:#e74c3c'>[HATA] ${err.message}</b>`);
            }
        });

        bot.on('end', () => {
            const reconnect = s.cfgs[user]?.auto;
            delete s.bots[user];
            if (reconnect) {
                s.logs[user].push("<b style='color:#f1c40f'>[OTO] Yeniden bağlanılıyor...</b>");
                setTimeout(() => startBot(sid, host, finalPort, user, ver, 'true'), 5000);
            }
        });
    } catch (e) {}
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

// Sunucu Başlatma
http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const q = parsed.query, p = parsed.pathname, s = getS(q.sid);

    try {
        if (p === '/start') { startBot(q.sid, q.host, q.port, q.user, q.ver, q.auto); return res.end("1"); }
        if (p === '/send') { if(s.bots[q.user]) s.bots[q.user].chat(decodeURIComponent(q.msg)); return res.end("1"); }
        if (p === '/tglspam') { s.cfgs[q.user].spamOn = (q.state === 'true'); return res.end("1"); }
        if (p === '/addspam') { 
            s.spams[q.user].push({ id: Date.now(), msg: decodeURIComponent(q.msg), delay: parseInt(q.delay), last: 0 }); 
            return res.end("1"); 
        }
        if (p === '/data') {
            const b = s.bots[q.user];
            const botData = b ? { hp: b.health, food: b.food, spams: s.spams[q.user], spamOn: s.cfgs[q.user].spamOn } : null;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ active: Object.keys(s.bots), logs: s.logs, botData }));
        }
    } catch(e) {}

    let filePath = path.join(__dirname, p === '/' ? 'index.html' : p);
    fs.readFile(filePath, (err, data) => {
        if (err) return res.end("404");
        let mime = path.extname(filePath) === '.js' ? 'text/javascript' : 'text/html';
        res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
        res.end(data);
    });
}).listen(process.env.PORT || 10000);
