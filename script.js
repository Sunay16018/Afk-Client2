class AFKClient {
    constructor() {
        this.selectedBot = null;
        this.socket = null;
        this.isConnected = false;
        this.movementKeys = {};
        this.init();
    }

    init() {
        this.setupSocket();
        this.setupEventListeners();
        this.setupTabs();
        this.setupSettings();
        this.setupMovementControls();
        this.checkConnection();
        
        // Klavye kısayolları için CSS ekle
        this.addKeyboardCSS();
    }

    setupSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            this.isConnected = true;
            this.addLog('Sunucuya bağlanıldı', 'success');
            document.getElementById('connection-status').style.color = '#2ecc71';
            document.getElementById('connection-status').textContent = 'Çevrimiçi';
        });

        this.socket.on('disconnect', () => {
            this.isConnected = false;
            this.addLog('Sunucu bağlantısı kesildi', 'error');
            document.getElementById('connection-status').style.color = '#ff4757';
            document.getElementById('connection-status').textContent = 'Çevrimdışı';
        });

        this.socket.on('connect_error', (error) => {
            console.log('Bağlantı hatası:', error);
            document.getElementById('connection-status').style.color = '#ff4757';
            document.getElementById('connection-status').textContent = 'Bağlantı Hatası';
        });

        this.socket.on('new_log', (data) => {
            if (data.username === this.selectedBot) {
                this.addLog(data.log.message, data.log.type, data.log.timestamp);
            }
        });

        this.socket.on('bot_data', (data) => {
            if (data.username === this.selectedBot) {
                this.updateBotStats(data.data);
                this.updateInventory(data.data.inventory);
                this.updateConfigDisplay(data.data.config);
                this.updateMovementDisplay(data.data.movement);
            }
        });

        this.socket.on('bot_stopped', (data) => {
            if (data.username === this.selectedBot) {
                this.selectedBot = null;
                this.clearBotDisplay();
                this.addLog(`${data.username} botu durduruldu`, 'warning');
            }
        });
    }

    setupEventListeners() {
        // Bağlantı formu
        document.getElementById('connect-btn').addEventListener('click', () => this.connectBot());
        
        // Mesaj gönderme
        document.getElementById('send-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendChat();
        });

        // Eşya atma
        document.getElementById('inv-box').addEventListener('click', (e) => {
            const slot = e.target.closest('.slot');
            if (slot && this.selectedBot) {
                const slotIndex = Array.from(slot.parentNode.children).indexOf(slot);
                this.dropItem(slotIndex);
            }
        });

        // Klavye kısayolları
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter' && document.activeElement.id !== 'chat-input') {
                document.getElementById('chat-input').focus();
            }
        });

        // Bot seçimi
        document.getElementById('bot-list').addEventListener('click', (e) => {
            const botCard = e.target.closest('.bot-card');
            if (botCard) {
                const botName = botCard.dataset.botName;
                if (botName !== this.selectedBot) {
                    this.selectBot(botName);
                }
            }
        });

        // Ayarlar butonu
        document.getElementById('settings-btn').addEventListener('click', () => {
            this.toggleSettings();
        });

        // Ayarlar kaydetme
        document.getElementById('save-settings').addEventListener('click', () => {
            this.saveSettings();
        });

        // Shift + Sağ Tık butonu
        document.getElementById('shift-click-btn').addEventListener('click', () => {
            this.performShiftClick();
        });
    }

    setupMovementControls() {
        // Hareket tuş haritası
        this.keyMap = {
            'w': 'forward',
            'W': 'forward',
            's': 'back', 
            'S': 'back',
            'a': 'left',
            'A': 'left',
            'd': 'right',
            'D': 'right',
            ' ': 'jump',
            'Shift': 'sneak',
            'Control': 'sprint'
        };

        // Klavye olaylarını dinle
        document.addEventListener('keydown', (e) => {
            if (this.shouldIgnoreKey(e)) return;
            
            const direction = this.keyMap[e.key];
            if (direction && this.selectedBot && !this.movementKeys[e.key]) {
                this.movementKeys[e.key] = true;
                this.sendMovement(direction, true);
                this.updateMovementUI(direction, true);
                e.preventDefault(); // Sayfa kaymasını engelle
            }
        });

        document.addEventListener('keyup', (e) => {
            if (this.shouldIgnoreKey(e)) return;
            
            const direction = this.keyMap[e.key];
            if (direction && this.movementKeys[e.key]) {
                this.movementKeys[e.key] = false;
                this.sendMovement(direction, false);
                this.updateMovementUI(direction, false);
                e.preventDefault();
            }
        });

        // Fare dışına çıkınca tüm tuşları bırak
        document.addEventListener('mouseleave', () => {
            this.releaseAllKeys();
        });

        // Pencere odak değişince tuşları bırak
        window.addEventListener('blur', () => {
            this.releaseAllKeys();
        });

        // Hareket butonları için event listener'lar
        this.setupMovementButtons();
    }

    setupMovementButtons() {
        // Hareket butonları
        const movementButtons = document.querySelectorAll('.movement-btn');
        movementButtons.forEach(btn => {
            // Mouse events
            btn.addEventListener('mousedown', (e) => {
                if (!this.selectedBot) {
                    this.showNotification('Önce bir bot seçin!', 'warning');
                    return;
                }
                
                const direction = e.currentTarget.dataset.direction;
                if (direction) {
                    this.sendMovement(direction, true);
                    this.updateMovementUI(direction, true);
                }
            });
            
            btn.addEventListener('mouseup', (e) => {
                const direction = e.currentTarget.dataset.direction;
                if (direction) {
                    this.sendMovement(direction, false);
                    this.updateMovementUI(direction, false);
                }
            });
            
            btn.addEventListener('mouseleave', (e) => {
                const direction = e.currentTarget.dataset.direction;
                if (direction) {
                    this.sendMovement(direction, false);
                    this.updateMovementUI(direction, false);
                }
            });
            
            // Touch events for mobile
            btn.addEventListener('touchstart', (e) => {
                if (!this.selectedBot) {
                    this.showNotification('Önce bir bot seçin!', 'warning');
                    return;
                }
                
                const direction = e.currentTarget.dataset.direction;
                if (direction) {
                    this.sendMovement(direction, true);
                    this.updateMovementUI(direction, true);
                    e.preventDefault();
                }
            });
            
            btn.addEventListener('touchend', (e) => {
                const direction = e.currentTarget.dataset.direction;
                if (direction) {
                    this.sendMovement(direction, false);
                    this.updateMovementUI(direction, false);
                    e.preventDefault();
                }
            });
        });

        // Özel aksiyon butonları
        document.getElementById('btn-attack').addEventListener('click', () => {
            if (!this.selectedBot) {
                this.showNotification('Önce bir bot seçin!', 'warning');
                return;
            }
            
            this.socket.emit('bot_action', {
                username: this.selectedBot,
                action: 'attack'
            });
            this.addLog('Saldırı yapıldı', 'info');
        });

        document.getElementById('btn-shift-click').addEventListener('click', () => {
            if (!this.selectedBot) {
                this.showNotification('Önce bir bot seçin!', 'warning');
                return;
            }
            
            this.socket.emit('bot_action', {
                username: this.selectedBot,
                action: 'shift_right_click'
            });
            this.addLog('Shift + Sağ Tık yapıldı', 'info');
        });
    }

    shouldIgnoreKey(e) {
        // Input alanlarındaysa hareket tuşlarını işleme
        const tagName = e.target.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea') {
            return true;
        }
        
        // Ctrl, Alt, Tab gibi tuşları filtrele
        if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Tab' || 
            e.key === 'Escape' || e.key === 'F5' || e.key === 'F12') {
            return true;
        }
        
        return false;
    }

    sendMovement(direction, state) {
        if (this.selectedBot && this.socket.connected) {
            this.socket.emit('bot_move', {
                username: this.selectedBot,
                direction: direction,
                state: state
            });
            
            // Konsola log ekle
            if (state) {
                this.addLog(`Hareket: ${direction} başladı`, 'info');
            } else {
                this.addLog(`Hareket: ${direction} durduruldu`, 'info');
            }
        }
    }

    releaseAllKeys() {
        for (const key in this.movementKeys) {
            if (this.movementKeys[key]) {
                const direction = this.keyMap[key];
                if (direction) {
                    this.sendMovement(direction, false);
                    this.updateMovementUI(direction, false);
                    this.movementKeys[key] = false;
                }
            }
        }
    }

    updateMovementUI(direction, active) {
        const btn = document.querySelector(`.movement-btn[data-direction="${direction}"]`);
        if (btn) {
            if (active) {
                btn.classList.add('active');
                btn.style.transform = 'scale(0.95)';
            } else {
                btn.classList.remove('active');
                btn.style.transform = '';
            }
        }
    }

    updateMovementDisplay(movement) {
        if (!movement) return;
        
        // Hareket butonlarını güncelle
        for (const [direction, state] of Object.entries(movement)) {
            this.updateMovementUI(direction, state);
        }
    }

    setupTabs() {
        const tabButtons = document.querySelectorAll('nav button');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabId = e.target.id.replace('btn-', 'tab-');
                this.switchTab(tabId);
            });
        });
    }

    setupSettings() {
        this.settingsPanel = document.getElementById('settings-panel');
        this.overlay = document.getElementById('settings-overlay');
        
        // Overlay'e tıklayınca kapat
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.closeSettings();
            }
        });

        // Auto-message ayarları
        const autoMsgToggle = document.getElementById('auto-message-toggle');
        const autoMsgFields = document.getElementById('auto-message-fields');
        
        autoMsgToggle.addEventListener('change', (e) => {
            autoMsgFields.style.display = e.target.checked ? 'block' : 'none';
        });

        // Auto-mine ayarları
        const autoMineToggle = document.getElementById('auto-mine-toggle');
        const autoMineFields = document.getElementById('auto-mine-fields');
        
        autoMineToggle.addEventListener('change', (e) => {
            autoMineFields.style.display = e.target.checked ? 'block' : 'none';
        });

        // Anti-AFK ayarları
        const antiAfkToggle = document.getElementById('anti-afk-toggle');
        const antiAfkFields = document.getElementById('anti-afk-fields');
        
        antiAfkToggle.addEventListener('change', (e) => {
            antiAfkFields.style.display = e.target.checked ? 'block' : 'none';
        });
    }

    switchTab(tabId) {
        // Tüm sekmeleri gizle
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.remove('active-tab');
        });
        
        // Tüm butonlardan aktif sınıfını kaldır
        document.querySelectorAll('nav button').forEach(btn => {
            btn.classList.remove('active');
        });
        
        // Hedef sekme ve butonu aktif yap
        document.getElementById(tabId).classList.add('active-tab');
        document.getElementById(`btn-${tabId.split('-')[1]}`).classList.add('active');
    }

    async connectBot() {
        const host = document.getElementById('host-input').value.trim();
        const username = document.getElementById('username-input').value.trim();
        const version = document.getElementById('version-input').value.trim();

        if (!host || !username) {
            this.showNotification('Lütfen IP ve isim girin!', 'error');
            return;
        }

        try {
            this.socket.emit('start_bot', { host, username, version });
            this.showNotification('Bot başlatılıyor...', 'info');
            
            // Formu temizle
            document.getElementById('host-input').value = '';
            document.getElementById('username-input').value = '';
            
            // Terminal sekmesine geç
            this.switchTab('tab-term');
            
        } catch (error) {
            this.showNotification(`Bağlantı hatası: ${error.message}`, 'error');
        }
    }

    selectBot(botName) {
        // Önceki seçili botu temizle
        document.querySelectorAll('.bot-card').forEach(card => {
            card.classList.remove('selected');
        });

        // Yeni botu seç
        this.selectedBot = botName;
        const selectedCard = document.querySelector(`.bot-card[data-bot-name="${botName}"]`);
        if (selectedCard) {
            selectedCard.classList.add('selected');
            this.addLog(`${botName} seçildi`, 'success');
            
            // Bot durumunu güncellemek için istek gönder
            if (this.socket.connected) {
                this.socket.emit('request_bot_data', { username: botName });
            }
            
            // Ayarlar panelindeki bot ismini güncelle
            document.getElementById('selected-bot-name').textContent = botName;
        }
    }

    sendChat() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();
        
        if (!message || !this.selectedBot) {
            this.showNotification('Lütfen bir mesaj yazın ve bot seçin!', 'warning');
            return;
        }

        this.socket.emit('send_chat', {
            username: this.selectedBot,
            message: message
        });

        input.value = '';
        input.focus();
    }

    dropItem(slotIndex) {
        if (!this.selectedBot) {
            this.showNotification('Lütfen önce bir bot seçin!', 'warning');
            return;
        }

        if (confirm('Bu eşyayı atmak istediğinize emin misiniz?')) {
            this.socket.emit('drop_item', {
                username: this.selectedBot,
                slot: slotIndex
            });
            this.addLog(`Slot ${slotIndex} eşyası atıldı`, 'info');
        }
    }

    performShiftClick() {
        if (!this.selectedBot) {
            this.showNotification('Önce bir bot seçin!', 'warning');
            return;
        }
        
        const x = document.getElementById('x-coord').value;
        const y = document.getElementById('y-coord').value;
        const z = document.getElementById('z-coord').value;
        
        if (!x || !y || !z) {
            this.showNotification('Lütfen X, Y, Z koordinatlarını girin!', 'warning');
            return;
        }
        
        this.socket.emit('bot_action', {
            username: this.selectedBot,
            action: 'shift_right_click',
            position: { x: parseFloat(x), y: parseFloat(y), z: parseFloat(z) }
        });
        
        this.addLog(`Shift + Sağ Tık: ${x}, ${y}, ${z}`, 'info');
    }

    addLog(message, type = 'info', timestamp = null) {
        const logbox = document.getElementById('logbox');
        const time = timestamp || new Date().toLocaleTimeString('tr-TR');
        
        const logElement = document.createElement('div');
        logElement.className = `log-message ${type}`;
        logElement.innerHTML = `
            <span class="log-time">[${time}]</span>
            <span class="log-content">${this.escapeHtml(message)}</span>
        `;
        
        logbox.appendChild(logElement);
        
        // Animasyon için
        setTimeout(() => {
            logElement.style.opacity = '1';
        }, 10);
        
        // Otomatik scroll
        logbox.scrollTop = logbox.scrollHeight;
        
        // Çok fazla log varsa temizle
        const logs = logbox.querySelectorAll('.log-message');
        if (logs.length > 200) {
            for (let i = 0; i < 50; i++) {
                if (logs[i]) logs[i].remove();
            }
        }
    }

    updateBotStats(data) {
        const statsElement = document.getElementById('bot-stats');
        if (!statsElement) return;

        statsElement.innerHTML = `
            <div class="stat-item">
                <span class="stat-icon health">❤️</span>
                <span class="stat-value">${Math.round(data.hp)}</span>
            </div>
            <div class="stat-item">
                <span class="stat-icon food">🍖</span>
                <span class="stat-value">${Math.round(data.food)}</span>
            </div>
            <div class="stat-item">
                <span class="stat-icon">📍</span>
                <span class="stat-value">${Math.round(data.position?.x || 0)}, ${Math.round(data.position?.y || 0)}, ${Math.round(data.position?.z || 0)}</span>
            </div>
        `;
    }

    updateInventory(inventory) {
        const invBox = document.getElementById('inv-box');
        if (!invBox) return;

        // 45 slot için HTML oluştur
        let html = '';
        for (let i = 0; i < 45; i++) {
            const item = inventory.find(item => item.slot === i);
            
            html += `
                <div class="slot" data-slot="${i}" title="${item ? item.displayName : 'Boş'}">
                    ${item ? `
                        <img src="https://raw.githubusercontent.com/PrismarineJS/minecraft-assets/master/data/1.16.1/items/${item.name}.png"
                             alt="${item.name}"
                             onerror="this.src='https://minecraft.wiki/images/Barrier_JE2_BE2.png'">
                        ${item.count > 1 ? `<span class="count">${item.count}</span>` : ''}
                    ` : ''}
                </div>
            `;
        }
        
        invBox.innerHTML = html;
    }

    updateConfigDisplay(config) {
        // Ayarlar panelindeki değerleri güncelle
        document.getElement