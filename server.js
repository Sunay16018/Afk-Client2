const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');

// Eklentiler
const autoEat = require('mineflayer-auto-eat').plugin;
const pvp = require('mineflayer-pvp').plugin;
const armorManager = require('mineflayer-armor-manager');
const parkour = require('mineflayer-parkour');

// Hataları yut, sistemi asla kapatma
process.on('uncaughtException', (e) => console.log(' [ERR]:', e.message));
process.on('unhandledRejection', (e) => console.log(' [REJ]:', e.message));

let sessions = {};
const getS = (sid) => {
    if (!sessions[sid]) sessions[sid] = { 
        bots: {}, 
        logs: {}, 
        cfgs: {}, 
        spamTimers: {},
        autoReconnect: {} // Her bot için otomatik reconnect ayarı
    };
    return sessions[sid];
};

function startBot(sid, host, port, user, ver, auto) {
    const s = getS(sid);
    if (s.bots[user]) return;

    // AUTO-RECONNECT AYARI
    s.autoReconnect[user] = (auto === 'true');

    // BOT AYARLARI (Proxy Korumalı - 90sn Timeout)
    const bot = mineflayer.createBot({
        host: host,
        port: parseInt(port) || 25565,
        username: user,
        version: ver,
        auth: 'offline',
        checkTimeoutInterval: 90000, 
        keepAlive: true,
        hideErrors: true,
        physics: {
            canFly: false,
            gravity: 0.08,
            jumpVelocity: 0.42,
            terminalVelocity: 3.92,
            playerSpeed: 0.1,
            sprintSpeed: 0.3
        }
    });

    // EKLENTİLERİ YÜKLE
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(pvp);
    bot.loadPlugin(autoEat);
    bot.loadPlugin(armorManager);
    
    // PARKOUR ÖZELLİĞİ
    try {
        parkour(bot);
    } catch(e) {}

    s.bots[user] = bot;
    s.logs[user] = s.logs[user] || [];
    s.cfgs[user] = { auto: auto === 'true', host, port, ver };

    // Log Fonksiyonu
    const log = (msg, color = "#8b949e") => {
        const time = new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
        s.logs[user].push(`<div style="color:${color}; border-bottom:1px solid #21262d;">[${time}] ${msg}</div>`);
        if (s.logs[user].length > 3000) s.logs[user].shift();
    };

    // OTOMATİK YEMEK SİSTEMİ
    bot.once('spawn', () => {
        bot.autoEat.options = {
            priority: 'foodPoints',
            startAt: 14, // 7 yemek çubuğunda yemeye başla
            bannedFood: ['poisonous_potato', 'pufferfish', 'spider_eye'],
            eatingTimeout: 3
        };
        bot.autoEat.enable();
        log("<b>[OTOMASYON]</b> Auto-eat sistemi aktif.", "#2ecc71");
    });

    // ZIRH YÖNETİCİSİ
    bot.on('spawn', () => {
        bot.armorManager.equipAll();
        log("<b>[OTOMASYON]</b> Zırh yöneticisi aktif.", "#3498db");
    });

    // PVP SİSTEMİ
    bot.pvp.on('startedAttacking', (target) => {
        log(`<b>[SALDIRI]</b> ${target.username} hedeflendi!`, "#e74c3c");
    });

    bot.pvp.on('stoppedAttacking', (target) => {
        log(`<b>[SALDIRI]</b> ${target.username} ile savaş durduruldu.`, "#f39c12");
    });

    // Saldırı tespiti
    bot.on('entityHurt', (entity) => {
        if (entity === bot.entity) {
            const attacker = bot.nearestEntity(e => 
                e.type === 'player' && e.position.distanceTo(bot.entity.position) < 5
            );
            if (attacker && !bot.pvp.target) {
                bot.pvp.attack(attacker);
                log(`<b>[SAVUNMA]</b> ${attacker.username} tarafından saldırıldı! Karşılık veriliyor.`, "#ff6b6b");
            }
        }
    });

    // Mob saldırıları için
    bot.on('entityHurt', (entity) => {
        if (entity === bot.entity) {
            const mobAttacker = bot.nearestEntity(e => 
                e.type !== 'player' && e.position.distanceTo(bot.entity.position) < 3
            );
            if (mobAttacker && !bot.pvp.target) {
                bot.pvp.attack(mobAttacker);
            }
        }
    });

    // GELİŞMİŞ PATHFINDER AYARLARI
    bot.on('inject_allowed', () => {
        try {
            const mcData = require('minecraft-data')(bot.version);
            const movements = new Movements(bot, mcData);
            
            // OPTİMİZE AYARLAR
            movements.canDig = false; // Kazma kapalı (Ban yememek için)
            movements.allowSprinting = true; // Her zaman koşmaya izin ver
            movements.allowParkour = true; // Parkour aktif
            movements.allow1by1towers = true; // 1x1 kulelere tırmanma
            movements.scafoldingBlocks = [];
            movements.maxDropDown = 4; // 4 blok yükseklikten atlayabilir
            
            // Tırmanma optimizasyonu
            movements.blocksCantBreak = new Set();
            movements.blocksToAvoid = new Set();
            
            bot.pathfinder.setMovements(movements);
            bot.pathfinder.thinkTimeout = 10000; // 10sn düşünme süresi
        } catch(e) { 
            log(`Pathfinder hatası: ${e.message}`, "#e74c3c"); 
        }
    });

    // --- GELİŞMİŞ ANTİ-AFK ---
    function antiAfk() {
        if (!bot.entity) return;
        const r = Math.random();
        if (r < 0.5) bot.look(Math.random()*6.28, (Math.random()-0.5)*0.5);
        else if (r < 0.8) { 
            bot.setControlState('jump', true); 
            setTimeout(()=>bot.setControlState('jump', false), 250); 
        }
        else { 
            bot.swingArm('right'); 
            // Oto-yemek kontrolü
            if (bot.food < 18 && bot.autoEat.enabled) {
                bot.autoEat.eat();
            }
        }
        setTimeout(antiAfk, 30000 + Math.random() * 60000);
    }
    
    bot.on('spawn', () => {
        log("<b>[GİRİŞ]</b> Sunucuya sızıldı.", "#2ecc71");
        setTimeout(antiAfk, 15000);
        
        // Zırhı kontrol et
        setTimeout(() => bot.armorManager.equipAll(), 3000);
    });

    bot.on('health', () => {
        if (bot.food < 16) {
            bot.autoEat.eat();
        }
    });

    bot.on('message', (json) => {
        try { log(json.toHTML()); } catch { log(json.toString()); }
    });

    bot.on('end', (reason) => {
        // Spam varsa durdur
        if (s.spamTimers[user]) { 
            clearInterval(s.spamTimers[user]); 
            delete s.spamTimers[user]; 
        }
        
        // Auto-reconnect kontrolü
        const shouldReconnect = s.autoReconnect[user] && s.cfgs[user]?.auto;
        delete s.bots[user];
        log(`<b>[KOPTU]</b> ${reason}`, "#e74c3c");
        
        if (shouldReconnect) {
            log("<b>[OTO]</b> 10sn sonra yeniden bağlanılıyor...", "#f1c40f");
            setTimeout(() => startBot(sid, host, port, user, ver, 'true'), 10000);
        } else {
            delete s.cfgs[user];
            delete s.autoReconnect[user];
        }
    });

    bot.on('error', (err) => log(`[HATA] ${err.message}`, "#e74c3c"));
    
    // Oto-yemek eventleri
    bot.on('autoeat_started', () => {
        log("<b>[AUTO-EAT]</b> Yemek yeme başladı.", "#27ae60");
    });
    
    bot.on('autoeat_finished', () => {
        log("<b>[AUTO-EAT]</b> Yemek yeme tamamlandı.", "#27ae60");
    });
    
    bot.on('armorEquipped', (oldArmor, newArmor) => {
        if (oldArmor.length !== newArmor.length) {
            log("<b>[ZIRH]</b> Yeni zırh ekipmanları giyildi.", "#9b59b6");
        }
    });
}

// --- SUNUCU API ---
http.createServer((req, res) => {
    const q = url.parse(req.url, true).query;
    const p = url.parse(req.url, true).pathname;
    const s = getS(q.sid);
    const b = s.bots[q.user];

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST');

    // Başlat
    if (p === '/start') { 
        startBot(q.sid, q.host, q.port, q.user, q.ver, q.auto); 
        return res.end("OK"); 
    }
    
    // Mesaj Gönder
    if (p === '/send') { 
        if(b) b.chat(decodeURIComponent(q.msg)); 
        return res.end("OK"); 
    }
    
    // --- KES (DISCONNECT) ENDPOINT ---
    if (p === '/kill') {
        if (b) {
            // Auto-reconnect'i devre dışı bırak
            s.autoReconnect[q.user] = false;
            if (s.cfgs[q.user]) s.cfgs[q.user].auto = false;
            
            // Spam timer'ı temizle
            if (s.spamTimers[q.user]) {
                clearInterval(s.spamTimers[q.user]);
                delete s.spamTimers[q.user];
            }
            
            // Botu kopart
            b.end();
            delete s.bots[q.user];
            
            logFunc = (msg, color) => {
                const time = new Date().toLocaleTimeString('tr-TR', {hour:'2-digit', minute:'2-digit'});
                s.logs[q.user].push(`<div style="color:${color}; border-bottom:1px solid #21262d;">[${time}] ${msg}</div>`);
            };
            logFunc("<b>[KESİLDİ]</b> Bot manuel olarak durduruldu. Auto-reconnect kapalı.", "#e74c3c");
        }
        return res.end("OK");
    }

    // --- AKILLI YÜRÜYÜŞ (GOTO) ---
    if (p === '/goto') { 
        if(b) {
            // Önceki manuel hareketleri durdur
            b.clearControlStates();
            const goal = new goals.GoalBlock(parseInt(q.x), parseInt(q.y), parseInt(q.z));
            b.pathfinder.setGoal(goal);
        }
        return res.end("OK"); 
    }

    // --- MANUEL HAREKET (BAS-GİT SİSTEMİ) ---
    if (p === '/move') {
        if(b) {
            // Pathfinder hedefini iptal et ki manuel yürüyebilsin
            b.pathfinder.setGoal(null); 
            b.setControlState(q.dir, q.state === 'true');
        }
        return res.end("OK");
    }

    // --- SPAM SİSTEMİ ---
    if (p === '/spam') {
        if(b) {
            if (q.state === 'true') {
                if (s.spamTimers[q.user]) clearInterval(s.spamTimers[q.user]);
                s.spamTimers[q.user] = setInterval(() => {
                    b.chat(decodeURIComponent(q.msg) + " " + Math.floor(Math.random()*999));
                }, parseInt(q.delay) || 3000);
            } else {
                if (s.spamTimers[q.user]) { 
                    clearInterval(s.spamTimers[q.user]); 
                    delete s.spamTimers[q.user]; 
                }
            }
        }
        return res.end("OK");
    }

    // Envanter At
    if (p === '/drop') {
        if(b && b.inventory.slots[parseInt(q.slot)]) {
            b.tossStack(b.inventory.slots[parseInt(q.slot)]);
        }
        return res.end("OK");
    }

    // Veri Çekme
    if (p === '/data') {
        res.setHeader('Content-Type', 'application/json');
        const pos = b && b.entity ? b.entity.position : null;
        const health = b ? Math.round(b.health) : 0;
        const food = b ? Math.round(b.food) : 0;
        
        return res.end(JSON.stringify({
            active: Object.keys(s.bots),
            logs: s.logs,
            spamming: !!s.spamTimers[q.user],
            botData: b ? { 
                hp: health, 
                food: food,
                armor: b.inventory.armor(),
                pos: pos ? {x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z)} : null,
                inv: b.inventory.slots.map((i, idx) => i ? {
                    name: i.name, 
                    count: i.count, 
                    slot: idx,
                    displayName: i.displayName || i.name
                } : null).filter(x => x)
            } : null
        }));
    }

    // Ana sayfa ve statik dosyalar
    fs.readFile(path.join(__dirname, p === '/' ? 'index.html' : p), (err, data) => {
        if (err) {
            res.statusCode = 404;
            res.end("404");
        } else {
            res.end(data);
        }
    });
}).listen(process.env.PORT || 10000);