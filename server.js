const mineflayer = require('mineflayer');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

const PORT = process.env.PORT || 10000;

// Oturum yönetimi
const sessions = new Map();

class BotSession {
    constructor(socketId) {
        this.socketId = socketId;
        this.bots = new Map();
        this.logs = new Map();
        this.configs = new Map();
        this.autoTasks = new Map();
        this.movementStates = new Map();
    }

    addBot(username, bot) {
        this.bots.set(username, bot);
        this.logs.set(username, []);
        this.configs.set(username, {
            autoMessage: { enabled: false, message: '', interval: 5 },
            autoMine: { enabled: false, targetBlock: 'diamond_ore' },
            antiAfk: { enabled: true, interval: 30 }
        });
        this.autoTasks.set(username, { 
            messageInterval: null, 
            mineInterval: null,
            antiAfkInterval: null 
        });
        this.movementStates.set(username, {
            forward: false,
            back: false,
            left: false,
            right: false,
            jump: false,
            sprint: false,
            sneak: false
        });
    }

    removeBot(username) {
        const bot = this.bots.get(username);
        if (bot) {
            try {
                bot.quit();
                bot.end();
            } catch (e) {
                // Hata yok say
            }
        }
        
        const tasks = this.autoTasks.get(username);
        if (tasks) {
            clearInterval(tasks.messageInterval);
            clearInterval(tasks.mineInterval);
            clearInterval(tasks.antiAfkInterval);
        }
        
        this.bots.delete(username);
        this.logs.delete(username);
        this.configs.delete(username);
        this.autoTasks.delete(username);
        this.movementStates.delete(username);
    }
}

// Socket.IO bağlantıları
io.on('connection', (socket) => {
    console.log('Yeni kullanıcı bağlandı:', socket.id);
    
    const session = new BotSession(socket.id);
    sessions.set(socket.id, session);

    socket.on('start_bot', (data) => {
        const { host, username, version } = data;
        startBot(socket, host, username, version);
    });

    socket.on('stop_bot', (username) => {
        const session = sessions.get(socket.id);
        if (session) {
            session.removeBot(username);
            socket.emit('bot_stopped', { username });
        }
    });

    socket.on('send_chat', (data) => {
        const session = sessions.get(socket.id);
        if (session && session.bots.has(data.username)) {
            try {
                session.bots.get(data.username).chat(data.message);
            } catch (e) {
                console.log('Mesaj gönderme hatası:', e.message);
            }
        }
    });

    socket.on('drop_item', (data) => {
        const session = sessions.get(socket.id);
        if (session && session.bots.has(data.username)) {
            const bot = session.bots.get(data.username);
            try {
                const item = bot.inventory.slots[data.slot];
                if (item) bot.tossStack(item);
            } catch (e) {
                console.log('Eşya atma hatası:', e.message);
            }
        }
    });

    socket.on('set_config', (data) => {
        const session = sessions.get(socket.id);
        if (session && session.configs.has(data.username)) {
            const config = session.configs.get(data.username);
            
            if (data.type === 'auto_message') {
                config.autoMessage = data.config;
                updateAutoMessage(socket, data.username, data.config);
            } else if (data.type === 'auto_mine') {
                config.autoMine = data.config;
                updateAutoMine(socket, data.username, data.config);
            } else if (data.type === 'anti_afk') {
                config.antiAfk = data.config;
                updateAntiAfk(socket, data.username, data.config);
            }
        }
    });

    // HAREKET KOMUTLARI
    socket.on('bot_move', (data) => {
        const session = sessions.get(socket.id);
        if (session && session.bots.has(data.username)) {
            const bot = session.bots.get(data.username);
            const states = session.movementStates.get(data.username);
            
            if (states) {
                states[data.direction] = data.state;
                
                try {
                    // Yön tuşları
                    if (data.direction === 'forward') {
                        bot.setControlState('forward', data.state);
                    } else if (data.direction === 'back') {
                        bot.setControlState('back', data.state);
                    } else if (data.direction === 'left') {
                        bot.setControlState('left', data.state);
                    } else if (data.direction === 'right') {
                        bot.setControlState('right', data.state);
                    } 
                    // Özel eylemler
                    else if (data.direction === 'jump') {
                        if (data.state) {
                            bot.setControlState('jump', true);
                            setTimeout(() => bot.setControlState('jump', false), 200);
                        }
                    } else if (data.direction === 'sprint') {
                        bot.setControlState('sprint', data.state);
                    } else if (data.direction === 'sneak') {
                        bot.setControlState('sneak', data.state);
                    }
                    
                    // Yürürken koşma otomatik aç
                    if ((states.forward || states.back || states.left || states.right) && !states.sprint) {
                        bot.setControlState('sprint', true);
                    } else if (!states.forward && !states.back && !states.left && !states.right) {
                        bot.setControlState('sprint', false);
                    }
                    
                } catch (e) {
                    console.log('Hareket hatası:', e.message);
                }
            }
        }
    });

    // ANLIK HAREKET KOMUTLARI
    socket.on('bot_action', (data) => {
        const session = sessions.get(socket.id);
        if (session && session.bots.has(data.username)) {
            const bot = session.bots.get(data.username);
            
            try {
                if (data.action === 'look') {
                    bot.look(data.yaw || 0, data.pitch || 0, true);
                } else if (data.action === 'jump') {
                    bot.jump();
                } else if (data.action === 'attack') {
                    bot.attack(bot.entity);
                } else if (data.action === 'shift_right_click') {
                    bot.setControlState('sneak', true);
                    setTimeout(() => {
                        bot.activateBlock(bot.blockAt(bot.entity.position));
                        setTimeout(() => {
                            bot.setControlState('sneak', false);
                        }, 500);
                    }, 200);
                }
            } catch (e) {
                console.log('Aksiyon hatası:', e.message);
            }
        }
    });

    socket.on('disconnect', () => {
        const session = sessions.get(socket.id);
        if (session) {
            for (const [username] of session.bots) {
                session.removeBot(username);
            }
            sessions.delete(socket.id);
        }
    });
});

function startBot(socket, host, username, version) {
    const [ip, port] = host.split(':');
    const session = sessions.get(socket.id);
    
    if (session.bots.has(username)) {
        socket.emit('log', { 
            username, 
            message: "[HATA] Bu isimle zaten bir bot aktif!" 
        });
        return;
    }

    session.logs.set(username, []);
    addLog(socket, username, "[SİSTEM] Bot başlatılıyor...", "info");

    try {
        const bot = mineflayer.createBot({
            host: ip,
            port: parseInt(port) || 25565,
            username: username,
            version: version || '1.16.5',
            auth: 'offline',
            hideErrors: true,
            checkTimeoutInterval: 30000,
            viewDistance: 'tiny',
            chatLengthLimit: 256,
            colorsEnabled: false
        });

        session.addBot(username, bot);

        // Bağlantı başarılı
        bot.once('login', () => {
            addLog(socket, username, "[BAŞARI] Oyuna giriş yapıldı!", "success");
            
            // Anti-AFK başlat
            setTimeout(() => {
                const config = session.configs.get(username);
                if (config && config.antiAfk && config.antiAfk.enabled) {
                    updateAntiAfk(socket, username, config.antiAfk);
                }
            }, 3000);
        });

        // Bağlantı hatası yönetimi
        bot.on('error', (err) => {
            if (!session.bots.has(username)) return;
            
            if (err.message.includes('connect') || err.message.includes('ECONNREFUSED')) {
                addLog(socket, username, "[HATA] Sunucuya bağlanılamadı!", "error");
            } else if (err.message.includes('timed out')) {
                addLog(socket, username, "[HATA] Bağlantı zaman aşımına uğradı!", "error");
            } else {
                addLog(socket, username, `[HATA] ${err.message}`, "error");
            }
            
            // Yeniden bağlanmayı dene
            setTimeout(() => {
                if (session.bots.has(username)) {
                    addLog(socket, username, "[SİSTEM] Yeniden bağlanılıyor...", "info");
                    try {
                        bot.end();
                        session.removeBot(username);
                        startBot(socket, host, username, version);
                    } catch (e) {
                        session.removeBot(username);
                    }
                }
            }, 10000);
        });

        // Atılma durumu
        bot.on('kicked', (reason) => {
            if (!session.bots.has(username)) return;
            
            addLog(socket, username, `[ATILDI] ${reason}`, "error");
            
            // Eğer "Flying is not enabled" hatası alındıysa, daha yavaş hareket et
            if (reason.includes('Flying') || reason.includes('flying')) {
                addLog(socket, username, "[SİSTEM] Anti-Fly koruması tespit edildi, ayarlar ayarlanıyor...", "warning");
            }
            
            // 20 saniye sonra yeniden dene
            setTimeout(() => {
                if (!session.bots.has(username)) {
                    addLog(socket, username, "[SİSTEM] Yeniden bağlanma deniyor...", "info");
                    startBot(socket, host, username, version);
                }
            }, 20000);
        });

        // Bağlantı kesildi
        bot.on('end', (reason) => {
            if (!session.bots.has(username)) return;
            
            if (reason !== 'restart') {
                addLog(socket, username, `[KOPUK] Bağlantı kesildi: ${reason || 'Bilinmeyen neden'}`, "warning");
                
                // 10 saniye sonra yeniden bağlan
                setTimeout(() => {
                    if (!session.bots.has(username)) {
                        addLog(socket, username, "[SİSTEM] Yeniden bağlanılıyor...", "info");
                        startBot(socket, host, username, version);
                    }
                }, 10000);
            }
        });

        // Mesajları yakala
        bot.on('message', (jsonMsg) => {
            const message = jsonMsg.toString();
            if (message.length < 100) {
                addLog(socket, username, message, "chat");
            }
        });

        // Action Bar
        bot.on('actionBar', (text) => {
            addLog(socket, username, `[ACTION] ${text.toString()}`, "action");
        });

        // Envanter güncellemesi
        bot.on('windowUpdate', () => {
            sendBotData(socket, username);
        });

        // Sağlık ve açlık güncellemesi
        bot.on('health', () => {
            sendBotData(socket, username);
        });

        // Can ve yemek değişimi
        bot.on('food', () => {
            sendBotData(socket, username);
        });

        // Spawn olayı
        bot.on('spawn', () => {
            addLog(socket, username, "[SİSTEM] Doğum noktasına ışınlandı", "info");
        });

        // Death olayı
        bot.on('death', () => {
            addLog(socket, username, "[SİSTEM] Öldü! Yeniden doğuyor...", "warning");
        });

        // Periyodik veri gönderimi
        const dataInterval = setInterval(() => {
            if (!session.bots.has(username)) {
                clearInterval(dataInterval);
                return;
            }
            sendBotData(socket, username);
        }, 1000);

        bot.on('end', () => clearInterval(dataInterval));

    } catch (error) {
        addLog(socket, username, `[HATA] Bot oluşturulamadı: ${error.message}`, "error");
    }
}

function addLog(socket, username, message, type = "info") {
    const session = sessions.get(socket.id);
    if (!session || !session.logs.has(username)) return;

    const logs = session.logs.get(username);
    logs.push({
        message,
        type,
        timestamp: new Date().toLocaleTimeString('tr-TR')
    });

    if (logs.length > 200) logs.shift();

    socket.emit('new_log', { username, log: logs[logs.length - 1] });
}

function sendBotData(socket, username) {
    const session = sessions.get(socket.id);
    if (!session || !session.bots.has(username)) return;

    const bot = session.bots.get(username);
    const config = session.configs.get(username);
    
    const inventory = bot.inventory.slots.map((item, index) => {
        if (!item) return null;
        return {
            name: item.name,
            count: item.count,
            slot: index,
            displayName: item.displayName
        };
    }).filter(item => item !== null);

    socket.emit('bot_data', {
        username,
        data: {
            hp: bot.health,
            food: bot.food,
            inventory,
            position: bot.entity.position,
            config: config || {},
            movement: session.movementStates.get(username) || {}
        }
    });
}

function updateAutoMessage(socket, username, config) {
    const session = sessions.get(socket.id);
    if (!session) return;

    const tasks = session.autoTasks.get(username);
    const bot = session.bots.get(username);

    if (tasks.messageInterval) {
        clearInterval(tasks.messageInterval);
        tasks.messageInterval = null;
    }

    if (config.enabled && bot && config.message && config.interval > 0) {
        tasks.messageInterval = setInterval(() => {
            if (bot) {
                try {
                    bot.chat(config.message);
                    addLog(socket, username, `[OTOMESAJ] Gönderildi: ${config.message}`, "info");
                } catch (e) {
                    // Hata mesajını görmezden gel
                }
            }
        }, config.interval * 1000);
    }
}

function updateAutoMine(socket, username, config) {
    const session = sessions.get(socket.id);
    if (!session) return;

    const tasks = session.autoTasks.get(username);
    const bot = session.bots.get(username);

    if (tasks.mineInterval) {
        clearInterval(tasks.mineInterval);
        tasks.mineInterval = null;
    }

    if (config.enabled && bot) {
        tasks.mineInterval = setInterval(async () => {
            if (!bot) return;

            try {
                const block = bot.findBlock({
                    matching: (block) => block.name === config.targetBlock,
                    maxDistance: 16
                });

                if (block) {
                    const tool = bot.pathfinder.bestHarvestTool(block);
                    if (tool) await bot.equip(tool, 'hand');
                    
                    await bot.dig(block);
                    addLog(socket, username, `[OTO-KAZMA] ${config.targetBlock} kazıldı`, "success");
                }
            } catch (err) {
                // Hata mesajını görmezden gel
            }
        }, 5000);
    }
}

function updateAntiAfk(socket, username, config) {
    const session = sessions.get(socket.id);
    if (!session) return;

    const tasks = session.autoTasks.get(username);
    const bot = session.bots.get(username);

    if (tasks.antiAfkInterval) {
        clearInterval(tasks.antiAfkInterval);
        tasks.antiAfkInterval = null;
    }

    if (config.enabled && bot) {
        tasks.antiAfkInterval = setInterval(() => {
            if (bot) {
                try {
                    // Rastgele küçük hareketler yap
                    const actions = ['jump', 'look', 'sneak'];
                    const action = actions[Math.floor(Math.random() * actions.length)];
                    
                    if (action === 'jump') {
                        bot.setControlState('jump', true);
                        setTimeout(() => bot.setControlState('jump', false), 200);
                    } else if (action === 'look') {
                        bot.look(Math.random() * Math.PI * 2, Math.random() * Math.PI - Math.PI / 2, true);
                    } else if (action === 'sneak') {
                        bot.setControlState('sneak', true);
                        setTimeout(() => bot.setControlState('sneak', false), 500);
                    }
                } catch (e) {
                    // Hata mesajını görmezden gel
                }
            }
        }, (config.interval || 30) * 1000);
    }
}

// Hata yakalama
process.on('uncaughtException', (err) => {
    console.error('Yakalanmamış Hata:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Yakalanmamış Red:', reason);
});

// Statik dosyalar
app.use(express.static(__dirname));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Sunucu ${PORT} portunda çalışıyor`);
});