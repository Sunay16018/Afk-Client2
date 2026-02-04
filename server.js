const mineflayer = require('mineflayer');
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');
const autoEat = require('mineflayer-auto-eat').plugin;
const pvp = require('mineflayer-pvp').plugin;
const armorManager = require('mineflayer-armor-manager');
const toolPlugin = require('mineflayer-tool').plugin;
const webInventory = require('mineflayer-web-inventory');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const chalk = require('chalk');
const moment = require('moment');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const bots = {};

// Hata Yönetimi (Sistem Kapanmasın)
process.on('uncaughtException', (e) => console.log(chalk.red('[KRITIK_HATA]'), e.message));

function createBot(data) {
    if (bots[data.user]) return;

    console.log(chalk.cyan(`[SİSTEM] ${data.user} başlatılıyor...`));

    const bot = mineflayer.createBot({
        host: data.host,
        port: parseInt(data.port) || 25565,
        username: data.user,
        version: data.ver,
        auth: 'offline',
        checkTimeoutInterval: 120000,
        keepAlive: true
    });

    // Plugin Yüklemeleri
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(autoEat);
    bot.loadPlugin(pvp);
    bot.loadPlugin(armorManager);
    bot.loadPlugin(toolPlugin);

    bot.cfg = { ...data, auto: true };
    bots[data.user] = bot;

    const sendLog = (msg, color = '#8b949e') => {
        const time = moment().format('HH:mm:ss');
        io.emit('bot_log', { 
            user: data.user, 
            html: `<div style="color:${color}; border-bottom:1px solid #21262d; padding:2px;">[${time}] ${msg}</div>` 
        });
    };

    bot.once('spawn', () => {
        sendLog(`Bağlantı başarılı! God-Mode modülleri aktif.`, '#238636');
        
        const mcData = require('minecraft-data')(bot.version);
        const movements = new Movements(bot, mcData);
        
        // HIZLI HAREKET AYARLARI
        movements.allowSprinting = true;
        movements.allowParkour = true;
        movements.canDig = false;
        bot.pathfinder.setMovements(movements);

        // OTO YEMEK AYARLARI
        bot.autoEat.options = { priority: 'foodPoints', startAt: 14, bannedFood: [] };
        
        // Web Envanter (İsteğe bağlı port: 3000 + bot sayısı)
        // webInventory(bot, { port: 3000 + Object.keys(bots).length });
    });

    bot.on('health', () => {
        if (bot.food < 15) bot.autoEat.eat();
    });

    bot.on('messagestr', (msg) => sendLog(msg));

    // OTOMATİK SAVUNMA (PVP)
    bot.on('attacked', (entity) => {
        if (entity.type === 'player' || entity.type === 'mob') {
            bot.pvp.attack(entity);
            sendLog(`Saldırı algılandı! Karşılık veriliyor: ${entity.name || entity.type}`, '#da3633');
        }
    });

    // PES ETMEME (AUTO-RECONNECT)
    bot.on('end', (reason) => {
        sendLog(`Bağlantı kesildi: ${reason}`, '#f1c40f');
        const user = bot.username;
        const cfg = bot.cfg;
        delete bots[user];
        io.emit('update_list', Object.keys(bots));

        if (cfg.auto) {
            sendLog(`10 saniye içinde yeniden bağlanılıyor...`, '#58a6ff');
            setTimeout(() => createBot(cfg), 10000);
        }
    });

    bot.on('error', (err) => sendLog(`Hata: ${err.message}`, '#da3633'));
    
    io.emit('update_list', Object.keys(bots));
}

// Socket İletişimi
io.on('connection', (socket) => {
    socket.emit('update_list', Object.keys(bots));

    socket.on('start_bot', (data) => createBot(data));

    socket.on('stop_bot', (user) => {
        if (bots[user]) {
            bots[user].cfg.auto = false;
            bots[user].quit();
            delete bots[user];
            io.emit('update_list', Object.keys(bots));
        }
    });

    socket.on('send_chat', (data) => {
        if (bots[data.user]) bots[data.user].chat(data.msg);
    });

    socket.on('move_bot', (data) => {
        const b = bots[data.user];
        if (b) {
            b.pathfinder.setGoal(null);
            b.setControlState(data.dir, data.state);
        }
    });

    socket.on('goto_coord', (data) => {
        const b = bots[data.user];
        if (b) {
            b.pathfinder.setGoal(new goals.GoalBlock(data.x, data.y, data.z));
        }
    });
});

// Canlı Veri Döngüsü
setInterval(() => {
    const data = {};
    for (const id in bots) {
        const b = bots[id];
        if (b.entity) {
            data[id] = {
                hp: b.health,
                food: b.food,
                pos: b.entity.position,
                inv: b.inventory.slots.filter(s => s).map(s => ({ name: s.name, count: s.count, slot: s.slot }))
            };
        }
    }
    io.emit('bot_data', data);
}, 1000);

app.use(express.static(__dirname));
server.listen(process.env.PORT || 10000, () => console.log(chalk.green('Sistem 10000 portunda aktif!')));
            
