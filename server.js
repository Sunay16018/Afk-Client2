const mineflayer = require('mineflayer');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// --- KRİTİK HATA YÖNETİMİ (Çökmeyi Engeller) ---
process.on('uncaughtException', (err) => console.error('Hata Yakalandı:', err));
process.on('unhandledRejection', (reason) => console.error('Red Yakalandı:', reason));

let sessions = {};
const getS = (sid) => {
    if (!sessions[sid]) sessions[sid] = { bots: {}, logs: {}, cfgs: {}, spams: {} };
    return sessions[sid];
};

// --- BOT MOTORU ---
function startBot(sid, host, port, user, ver, auto) {
    const s = getS(sid);
    if (s.bots[user]) {
        if(s.logs[user]) s.logs[user].push("<b style='color:#e74c3c'>[SİSTEM] Bu bot zaten aktif!</b>");
        return;
    }

    const finalPort = parseInt(port) || 25565;
    s.logs[user] = s.logs[user] || [];
    s.logs[user].push(`<b style='color:#3498db'>[SİSTEM] ${user} bağlanıyor... (${host}:${finalPort})</b>`);
    
    s.cfgs[user] = {
        auto: auto === 'true',
        spamOn: false,
        host: host,
        port: finalPort,
        ver: ver,
        moves: { forward: false, back: false, left: false, right: false, jump: false }
    };
    s.spams[user] = s.spams[user] || [];

    try {
        const bot = mineflayer.createBot({
            host: host, port: finalPort,
            username: user, version: ver, auth: 'offline',
            hideErrors: true
        });

        s.bots[user] = bot;

        bot.on('login', () => s.logs[user].push("<b style='color:#2ecc71'>[BAĞLANTI] Başarılı! Sunucuya girildi.</b>"));
        
        bot.on('message', (m) => {
            try {
                const html = m.toHTML();
                if (m.toString().trim()) s.logs[user].push(html);
                if (s.logs[user].length > 100) s.logs[user].shift();
            } catch(e) {}
        });

        bot.on('end', () => {
            const reconnect = s.cfgs[user] ? s.cfgs[user].auto : false;
            delete s.bots[user];
            if (reconnect) {
                s.logs[user].push("<b style='color:#f1c40f'>[OTOMATİK] Bağlantı koptu, 5sn sonra tekrar...</b>");
                setTimeout(() => startBot(sid, host, finalPort, user, ver, 'true'), 5000);
            } else {
                s.logs[user].push("<b style='color:#e74c3c'>[BİLGİ] Bağlantı sonlandırıldı.</b>");
            }
        });

        bot.on('error', (err) => s.logs[user].push(`<b style='color:#ff4757'>[HATA] ${err.message}</b>`));
    } catch (e) { console.log("Bot yaratma hatası."); }
}

// --- GÜVENLİ SPAM MOTORU ---
setInterval(() => {
    Object.values(sessions).forEach(s => {
        Object.keys(s.bots).forEach(user => {
            if (s.cfgs[user] && s.cfgs[user].spamOn && s.bots[user]) {
                s.spams[user].forEach(item => {
                    const safeDelay = Math.max(1, item.delay); // Negatif süreyi engeller
                    if (Date.now() - item.last >= safeDelay * 1000) {
                        try { s.bots[user].chat(item.msg); } catch(e) {}
                        item.last = Date.now();
                    }
                });
            }
        });
    });
}, 1000);

// --- WEB SUNUCUSU VE MIME TÜRÜ DÜZELTMESİ ---
http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const q = parsed.query;
    const p = parsed.pathname;
    const s = getS(q.sid);

    // API İŞLEMLERİ
    try {
        if (p === '/start') { startBot(q.sid, q.host, q.port, q.user, q.ver, q.auto); return res.end("1"); }
        if (p === '/stop') { s.cfgs[q.user].auto = false; s.bots[q.user].quit(); return res.end("1"); }
        if (p === '/send') { s.bots[q.user].chat(decodeURIComponent(q.msg)); return res.end("1"); }
        if (p === '/move') { s.bots[q.user].setControlState(q.dir, q.state === 'true'); return res.end("1"); }
        if (p === '/tglspam') { s.cfgs[q.user].spamOn = (q.state === 'true'); return res.end("1"); }
        if (p === '/addspam') { 
            const d = Math.max(1, parseInt(q.delay) || 5);
            s.spams[q.user].push({ id: Date.now(), msg: decodeURIComponent(q.msg), delay: d, last: 0 }); 
            return res.end("1"); 
        }
        if (p === '/delspam') { s.spams[q.user] = s.spams[q.user].filter(x => x.id != q.id); return res.end("1"); }
        if (p === '/data') {
            const b = s.bots[q.user];
            const botData = b ? { 
                hp: b.health, 
                food: b.food, 
                inv: b.inventory.slots.map((i, idx) => i ? {name: i.name, count: i.count, slot: idx} : null).filter(x => x), 
                spams: s.spams[q.user], 
                spamOn: s.cfgs[q.user].spamOn 
            } : null;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ active: Object.keys(s.bots), logs: s.logs, botData }));
        }
    } catch (e) {}

    // DOSYA SUNMA (HTML'İN DÜZGÜN GÖRÜNMESİNİ SAĞLAR)
    let filePath = path.join(__dirname, p === '/' ? 'index.html' : p);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, {'Content-Type': 'text/plain'});
            res.end("Dosya Bulunamadi");
            return;
        }

        // MIME Türünü Belirleme (HTML mi, JS mi?)
        let ext = path.extname(filePath);
        let contentType = 'text/html';
        if (ext === '.js') contentType = 'text/javascript';
        if (ext === '.css') contentType = 'text/css';

        res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
        res.end(data);
    });

}).listen(process.env.PORT || 10000);

console.log("Sunucu port 10000 üzerinde aktif!");
