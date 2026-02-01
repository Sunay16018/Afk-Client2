const mineflayer = require('mineflayer');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// GLOBAL HATA DUVARI (Sunucu Çökmez)
process.on('uncaughtException', (err) => console.error('Kritik:', err));
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
    s.logs[user].push(`<b style='color:#3498db'>[PROXY] ${user} tünel bağlantısı kuruluyor...</b>`);
    
    s.cfgs[user] = { auto: auto === 'true', spamOn: false, host: host, port: finalPort, ver: ver };
    s.spams[user] = s.spams[user] || [];

    try {
        const bot = mineflayer.createBot({
            host: host, port: finalPort, username: user, version: ver, auth: 'offline',
            // --- AKILLI PROXY AYARLARI ---
            checkTimeoutInterval: 180000, // 3 Dakika tolerans (Lobi geçişleri için)
            hideErrors: true,
            keepAlive: true,
            loadInternalPlugins: true
        });

        bot.setMaxListeners(0);
        s.bots[user] = bot;

        // --- %100 GARANTİLİ CHAT SİSTEMİ (Messagestr) ---
        // Bu olay, sunucu ne gönderirse göndersin (JSON bozuk olsa bile) metni yakalar.
        bot.on('messagestr', (msg, position, jsonMsg) => {
            if (!msg || msg.trim().length === 0) return;
            
            // Renk kodlarını temizle ve HTML güvenli hale getir
            // İsimlerin görünmemesi imkansız çünkü ham veriyi alıyoruz
            let cleanMsg = msg.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            
            // Loga ekle
            s.logs[user].push(`<span style="color:#ddd;">${cleanMsg}</span>`);
            
            // Log temizliği
            if (s.logs[user].length > 250) s.logs[user].shift();
        });

        // Giriş ve Olaylar
        bot.on('login', () => s.logs[user].push("<b style='color:#2ecc71'>[BAĞLANTI] Lobiye Giriş Yapıldı!</b>"));
        bot.on('spawn', () => s.logs[user].push("<b style='color:#f1c40f'>[DÜNYA] Dünya yüklendi/değiştirildi.</b>"));
        bot.on('kicked', (r) => s.logs[user].push(`<b style='color:red'>[ATILDI] Sebep: ${r}</b>`));

        // Proxy Hata Yönetimi
        bot.on('error', (err) => {
            if (err.message.includes('array size') || err.message.includes('read ECONNRESET')) {
                // Bu hatalar proxy geçişlerinde normaldir, yoksay.
            } else {
                s.logs[user].push(`<b style='color:#e74c3c'>[HATA] ${err.message}</b>`);
            }
        });

        bot.on('end', () => {
            const reconnect = s.cfgs[user]?.auto;
            delete s.bots[user];
            if (reconnect) {
                s.logs[user].push("<b style='color:#f1c40f'>[OTO] Proxy bağlantısı koptu, 5sn içinde yenileniyor...</b>");
                setTimeout(() => startBot(sid, host, finalPort, user, ver, 'true'), 5000);
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

// Sunucu
http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const q = parsed.query, p = parsed.pathname, s = getS(q.sid);

    try {
        if (p === '/start') { startBot(q.sid, q.host, q.port, q.user, q.ver, q.auto); return res.end("1"); }
        if (p === '/stop') { if(s.bots[q.user]) { s.bots[q.user].quit(); s.cfgs[q.user].auto = false; } return res.end("1"); }
        if (p === '/send') { if(s.bots[q.user]) s.bots[q.user].chat(decodeURIComponent(q.msg)); return res.end("1"); }
        if (p === '/move') { if(s.bots[q.user]) s.bots[q.user].setControlState(q.dir, q.state === 'true'); return res.end("1"); }
        if (p === '/tglspam') { s.cfgs[q.user].spamOn = (q.state === 'true'); return res.end("1"); }
        if (p === '/addspam') { s.spams[q.user].push({ id: Date.now(), msg: decodeURIComponent(q.msg), delay: parseInt(q.delay), last: 0 }); return res.end("1"); }
        if (p === '/delspam') { s.spams[q.user] = s.spams[q.user].filter(x => x.id != q.id); return res.end("1"); }
        
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

    let filePath = path.join(__dirname, p === '/' ? 'index.html' : p);
    fs.readFile(filePath, (err, data) => {
        if (err) return res.end("404");
        // MIME Type fix (Ekranın bozuk görünmemesi için)
        let mime = path.extname(filePath) === '.js' ? 'text/javascript' : 'text/html';
        res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
        res.end(data);
    });
}).listen(process.env.PORT || 10000);
