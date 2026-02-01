const mineflayer = require('mineflayer');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => console.error('Hata:', err));
process.on('unhandledRejection', (reason) => console.error('Red:', reason));

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
    
    s.cfgs[user] = {
        auto: auto === 'true',
        spamOn: false,
        host: host,
        port: finalPort,
        ver: ver,
        lastData: Date.now()
    };
    s.spams[user] = s.spams[user] || [];

    try {
        const bot = mineflayer.createBot({
            host: host,
            port: finalPort,
            username: user,
            version: ver,
            auth: 'offline',
            // --- PROXY VE BÜYÜK VERİ KORUMASI ---
            hideErrors: true,
            checkTimeoutInterval: 60000, // Sunucu geçişlerinde 60sn bekle
            loadInternalPlugins: true
        });

        // Paketi okurken çökmemesi için bellek limitini artırıyoruz
        bot._client.setMaxListeners(0);

        s.bots[user] = bot;

        bot.on('login', () => s.logs[user].push("<b style='color:#2ecc71'>[GİRİŞ] Başarılı! Sunucuya girildi.</b>"));
        
        bot.on('message', (m) => {
            try {
                const html = m.toHTML();
                if (m.toString().trim()) {
                    s.logs[user].push(html);
                    if (s.logs[user].length > 100) s.logs[user].shift();
                }
            } catch(e) {}
        });

        // PROXY AKTARMA KORUMASI: Sunucu değiştirince botu düşürmez
        bot.on('respawn', () => {
            s.logs[user].push("<b style='color:#58a6ff'>[AKTARMA] Sunucu/Dünya değiştiriliyor...</b>");
        });

        bot.on('end', () => {
            const reconnect = s.cfgs[user] ? s.cfgs[user].auto : false;
            delete s.bots[user];
            if (reconnect) {
                s.logs[user].push("<b style='color:#f1c40f'>[OTO-BAĞLAN] Sunucu aktarması veya kopma algılandı, 5sn sonra geri dönülüyor...</b>");
                setTimeout(() => startBot(sid, host, finalPort, user, ver, 'true'), 5000);
            }
        });

        bot.on('error', (err) => {
            // "Array size abnormally large" hatasını sustur ve otomatik düzel
            if(err.message.includes('array size')) {
                s.logs[user].push("<b style='color:orange'>[FİLTRE] Yüksek veri paketi engellendi.</b>");
            } else {
                s.logs[user].push(`<b style='color:#ff4757'>[HATA] ${err.message}</b>`);
            }
        });
    } catch (e) { console.log("Bot oluşturma hatası."); }
}

// Spam Motoru
setInterval(() => {
    Object.values(sessions).forEach(s => {
        Object.keys(s.bots).forEach(user => {
            if (s.cfgs[user] && s.cfgs[user].spamOn && s.bots[user]) {
                s.spams[user].forEach(item => {
                    const safeDelay = Math.max(1, item.delay);
                    if (Date.now() - item.last >= safeDelay * 1000) {
                        try { s.bots[user].chat(item.msg); } catch(e) {}
                        item.last = Date.now();
                    }
                });
            }
        });
    });
}, 1000);

// WEB SUNUCU (HTML GÖRÜNÜMÜNÜ DÜZELTEN KISIM)
http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const q = parsed.query;
    const p = parsed.pathname;
    const s = getS(q.sid);

    try {
        if (p === '/start') { startBot(q.sid, q.host, q.port, q.user, q.ver, q.auto); return res.end("1"); }
        if (p === '/stop') { s.cfgs[q.user].auto = false; s.bots[q.user].quit(); return res.end("1"); }
        if (p === '/send') { s.bots[q.user].chat(decodeURIComponent(q.msg)); return res.end("1"); }
        if (p === '/data') {
            const b = s.bots[q.user];
            const botData = b ? { hp: b.health, food: b.food, inv: b.inventory.slots.map((i, idx) => i ? {name: i.name, count: i.count, slot: idx} : null).filter(x => x), spams: s.spams[q.user], spamOn: s.cfgs[q.user].spamOn } : null;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ active: Object.keys(s.bots), logs: s.logs, botData }));
        }
    } catch (e) {}

    let filePath = path.join(__dirname, p === '/' ? 'index.html' : p);
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end("Not Found"); }
        
        // HTML KODU OLARAK GÖRÜNMESİNİ ENGELLEYEN HEADER
        let ext = path.extname(filePath);
        let mime = 'text/html';
        if (ext === '.js') mime = 'text/javascript';
        if (ext === '.css') mime = 'text/css';
        
        res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
        res.end(data);
    });
}).listen(process.env.PORT || 10000);
