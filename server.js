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
    if (s.bots[user]) {
        s.logs[user].push("<b style='color:orange'>[SİSTEM] Bot zaten çalışıyor!</b>");
        return;
    }

    const [ip, port] = host.split(':');
    s.logs[user] = ["<b style='color:gray'>[SİSTEM] Başlatılıyor...</b>"];

    const bot = mineflayer.createBot({
        host: ip, 
        port: parseInt(port) || 25565, 
        username: user, 
        version: ver, 
        auth: 'offline'
    });

    s.bots[user] = bot;
    s.configs[user] = { 
        msgT: null, 
        afkT: null,
        digging: false,
        currentTarget: null,
        controls: {},
        settings: {
            reconnect: true,
            antiafk: false
        }
    };

    bot.on('login', () => {
        s.logs[user].push("<b style='color:#2ecc71'>[GİRİŞ] " + user + " oyuna girdi!</b>");
    });
    
    bot.on('message', (m) => {
        const msg = m.toString();
        // Türkçe karakterleri düzelt
        const cleanMsg = msg.replace(/Ã§/g, 'ç')
                           .replace(/Ã¶/g, 'ö')
                           .replace(/Ã¼/g, 'ü')
                           .replace(/Ä±/g, 'ı')
                           .replace(/ÅŸ/g, 'ş')
                           .replace(/ÄŸ/g, 'ğ')
                           .replace(/Ã‡/g, 'Ç')
                           .replace(/Ã–/g, 'Ö')
                           .replace(/Ãœ/g, 'Ü')
                           .replace(/Ä°/g, 'İ')
                           .replace(/Åž/g, 'Ş')
                           .replace(/Äž/g, 'Ğ');
        s.logs[user].push(cleanMsg);
        if(s.logs[user].length > 100) s.logs[user].shift();
    });

    // KAZMA SİSTEMİ
    function startDigging() {
        if (!s.configs[user].digging || !bot) return;
        
        const block = bot.blockAtCursor(5);
        if (block && block.diggable) {
            s.configs[user].currentTarget = block;
            bot.dig(block, (err) => {
                if (err) {
                    s.logs[user].push("<b style='color:#ff4757'>[KAZMA] Hata: " + err.message + "</b>");
                } else {
                    s.logs[user].push("<b style='color:#2ecc71'>[KAZMA] Blok kırıldı!</b>");
                }
                // Blok kırıldıktan sonra 500ms bekle ve tekrar dene
                setTimeout(() => {
                    if (s.configs[user].digging) {
                        startDigging();
                    }
                }, 500);
            });
        } else {
            // Kazılacak blok yoksa 1 saniye bekle ve tekrar dene
            setTimeout(() => {
                if (s.configs[user].digging) {
                    startDigging();
                }
            }, 1000);
        }
    }

    // BOT DÜŞÜNCE TEMİZLİK
    bot.on('end', () => {
        if(s.logs[user]) s.logs[user].push("<b style='color:#ff4757'>[BAĞLANTI] Bağlantı kesildi.</b>");
        if (s.configs[user].settings.reconnect) {
            s.logs[user].push("<b style='color:orange'>[SİSTEM] 10 saniye sonra yeniden bağlanılıyor...</b>");
            setTimeout(() => {
                if (!s.bots[user]) {
                    startBot(sid, host, user, ver);
                }
            }, 10000);
        }
        delete s.bots[user];
    });

    bot.on('kicked', (reason) => {
        s.logs[user].push("<b style='color:#ff4757'>[ATILDI] Sunucu bağlantıyı kesti: " + reason + "</b>");
        delete s.bots[user];
    });

    bot.on('error', (e) => { 
        s.logs[user].push("<b style='color:#ff4757'>[HATA] " + e.message + "</b>"); 
        delete s.bots[user]; 
    });
}

const server = http.createServer((req, res) => {
    const q = url.parse(req.url, true).query;
    const p = url.parse(req.url, true).pathname;
    const sid = q.sid;
    
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (!sid && p !== '/' && p !== '/index.html') return res.end("No SID");

    const s = getSession(sid);
    const bot = s.bots[q.user];

    if (p === '/start') { 
        startBot(sid, q.host, q.user, q.ver); 
        return res.end("ok"); 
    }
    
    if (p === '/stop' && bot) { 
        bot.quit(); 
        delete s.bots[q.user]; 
        return res.end("ok"); 
    }
    
    if (p === '/send' && bot) { 
        bot.chat(decodeURIComponent(q.msg)); 
        return res.end("ok"); 
    }
    
    if (p === '/update' && bot) {
        const conf = s.configs[q.user];
        if (q.type === 'inv' && q.status === 'drop') {
            const item = bot.inventory.slots[parseInt(q.val)];
            if (item) bot.tossStack(item);
        } else if (q.type === 'msg') {
            clearInterval(conf.msgT);
            if (q.status === 'on') conf.msgT = setInterval(() => bot.chat(decodeURIComponent(q.val)), q.sec * 1000);
        } else if (q.type === 'setting') {
            conf.settings[q.setting] = q.value === 'true';
        }
        return res.end("ok");
    }

    // KAZMA ENDPOINT'İ
    if (p === '/dig' && bot) {
        const conf = s.configs[q.user];
        if (q.action === 'start') {
            conf.digging = true;
            startDigging(q.user, sid);
            s.logs[q.user].push("<b style='color:#2ecc71'>[KAZMA] Akıllı kazma başlatıldı!</b>");
        } else if (q.action === 'stop') {
            conf.digging = false;
            conf.currentTarget = null;
            s.logs[q.user].push("<b style='color:#ffa502'>[KAZMA] Kazma durduruldu.</b>");
        }
        return res.end("ok");
    }

    // HAREKET KONTROL ENDPOINT'İ
    if (p === '/control' && bot) {
        const direction = q.direction;
        const state = q.state === 'true';
        
        const controlMap = {
            'forward': 'forward',
            'back': 'back',
            'left': 'left',
            'right': 'right',
            'jump': 'jump'
        };
        
        if (controlMap[direction]) {
            bot.setControlState(controlMap[direction], state);
            s.configs[q.user].controls[direction] = state;
        }
        return res.end("ok");
    }

    if (p === '/data' && sid) {
        const active = Object.keys(s.bots);
        const botData = {};
        
        active.forEach(username => {
            const b = s.bots[username];
            if (b) {
                botData[username] = {
                    hp: b.health || 0,
                    food: b.food || 0,
                    inv: b.inventory.slots.map((i, idx) => i ? {
                        name: i.name, 
                        count: i.count, 
                        slot: idx, 
                        display: i.displayName
                    } : null).filter(x => x !== null)
                };
            }
        });
        
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ 
            active, 
            logs: s.logs, 
            botData 
        }));
    }

    // DOSYA SUNUCU
    let filePath = path.join(__dirname, p === '/' ? 'index.html' : p);
    const extname = path.extname(filePath);
    let contentType = 'text/html';
    
    switch (extname) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
        case '.json': contentType = 'application/json'; break;
        case '.png': contentType = 'image/png'; break;
        case '.jpg': contentType = 'image/jpg'; break;
    }
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if(err.code === 'ENOENT') {
                fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(content, 'utf-8');
                });
            } else {
                res.writeHead(500);
                res.end('Sunucu hatası: ' + err.code);
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`AFK Client sunucusu ${PORT} portunda çalışıyor...`);
});