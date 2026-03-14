const { WebContentsView } = require('electron');

class PlatformManager {
    constructor() {
        this.activePlatform = null;
        this.views = {};
        this.mainWindow = null; 
        this.targetVolume = 1.0; 
        
        this.urls = {
            ytmusic: 'https://music.youtube.com/',
            applemusic: 'https://music.apple.com/',
            soundcloud: 'https://soundcloud.com/'
        };

        this.scripts = {
            ytmusic: {
                'play-pause': "document.querySelector('#play-pause-button')?.click()",
                'next-track': "document.querySelector('.next-button')?.click()",
                'prev-track': "document.querySelector('.previous-button')?.click()"
            },
            applemusic: {
                'play-pause': "try { document.querySelector('button[aria-label=\"Play\"], button[aria-label=\"Pause\"], .web-chrome-playback-controls__play-pause-btn')?.click() || Array.from(document.querySelectorAll('audio, video')).find(e=>e.duration).paused ? Array.from(document.querySelectorAll('audio, video')).find(e=>e.duration).play() : Array.from(document.querySelectorAll('audio, video')).find(e=>e.duration).pause(); } catch(e){}",
                'next-track': "try { document.querySelector('button[aria-label=\"Next\"], .web-chrome-playback-controls__next-btn')?.click(); } catch(e){}",
                'prev-track': "try { document.querySelector('button[aria-label=\"Previous\"], .web-chrome-playback-controls__prev-btn')?.click(); } catch(e){}"
            },
            soundcloud: {
                'play-pause': "document.querySelector('.playControl')?.click()",
                'next-track': "document.querySelector('.skipControl__next')?.click()",
                'prev-track': "document.querySelector('.skipControl__previous')?.click()"
            }
        };
    }

    setMainWindow(win) {
        this.mainWindow = win;
        // 綁定視窗縮放事件，讓內嵌視圖可以跟隨縮放
        this.mainWindow.on('resize', () => {
            if (this.activePlatform && this.activePlatform !== 'local' && this.views[this.activePlatform]) {
                this.resizeView(this.views[this.activePlatform]);
            }
        });
    }

    resizeView(view) {
        if (!this.mainWindow) return;
        const bounds = this.mainWindow.getContentBounds();
        // 底端預留 80px 給控制列
        view.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height - 80 });
    }

    switchPlatform(platformId) {
        // 從主視窗移除其他平台的 WebContentsView 並強制暫停音樂以節省記憶體/CPU
        Object.keys(this.views).forEach((key) => {
            if (key !== platformId && this.views[key]) {
                try {
                    if (this.views[key].webContents && !this.views[key].webContents.isDestroyed()) {
                        this.views[key].webContents.executeJavaScript(`
                            try { document.querySelectorAll('video, audio').forEach(el => el.pause()); } catch(e){}
                        `);
                    }
                    this.mainWindow.contentView.removeChildView(this.views[key]);
                } catch(e){}
            }
        });

        // Local 模式：只需移除其他 View 即可，UI 由 index.html 自己顯示
        if (platformId === 'local') {
            this.activePlatform = 'local';
            console.log(`Platform switched to: local`);
            return null;
        }

        if (!this.urls[platformId]) return;

        // 如果該平台視圖尚未建立，則初始化 WebContentsView
        if (!this.views[platformId]) {
            const view = new WebContentsView({
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    backgroundThrottling: false, // 關閉背景節流以解決 SoundCloud 等音樂網站因被判定在背景而發生卡頓
                }
            });
            
            // 使用動態去除 Electron 標籤的方式偽裝，避免寫死 UA 造成 Spotify 發生頁面崩潰錯誤
            const cleanUserAgent = view.webContents.userAgent.replace(/Electron\/\S+\s/g, '');
            view.webContents.userAgent = cleanUserAgent;
            
            // 允許彈出視窗 (解決 SoundCloud 點擊第三方登入如 Google 時被阻擋的問題)
            view.webContents.setWindowOpenHandler(() => {
                return { action: 'allow' };
            });

            // 僅在 SoundCloud 注入 Hook，避免搞壞 Spotify 的嚴格 React 環境或 DRM
            if (platformId === 'soundcloud') {
                view.webContents.on('dom-ready', () => {
                    view.webContents.executeJavaScript(`
                        if (!window.__GUA_MEDIAS) {
                            window.__GUA_MEDIAS = new Set();
                            if (window.HTMLMediaElement) {
                                const origPlay = window.HTMLMediaElement.prototype.play;
                                window.HTMLMediaElement.prototype.play = function() {
                                    window.__GUA_MEDIAS.add(this);
                                    return origPlay.apply(this, arguments);
                                };
                            }
                        }
                    `);
                });
            }

            view.webContents.loadURL(this.urls[platformId]);
            this.views[platformId] = view;
        }

        // 掛載到 主視窗 上
        this.mainWindow.contentView.addChildView(this.views[platformId]);
        
        // 確保視圖縮放正常 (扣除新標題列 38px 和底部 80px 控制列)
        this.resizeView(this.views[platformId]);

        this.activePlatform = platformId;
        this.startStatusPolling();

        console.log(`Platform mapped to WebContentsView: ${platformId}`);
        return this.views[platformId];
    }

    startStatusPolling() {
        if (this.statusInterval) clearInterval(this.statusInterval);
        this.statusInterval = setInterval(async () => {
             if (this.activePlatform === 'local' || !this.activePlatform) return;
             const view = this.views[this.activePlatform];
             if (!view || !view.webContents || view.webContents.isDestroyed()) return;

             try {
                const status = await view.webContents.executeJavaScript(`
                    (() => {
                        let allMedia = Array.from(document.querySelectorAll('video, audio'));
                        if (window.__GUA_MEDIAS) window.__GUA_MEDIAS.forEach(m => allMedia.push(m));
                        
                        // 暴力強制持續鎖定音量給所有標籤，確保切換或新歌載入時生效
                        allMedia.forEach(m => {
                            if (Math.abs(m.volume - ${this.targetVolume}) > 0.01) {
                                m.volume = ${this.targetVolume};
                            }
                        });
                        
                        let activeMedia = allMedia.find(el => !el.paused && el.duration > 0) || allMedia[0];
                        if (activeMedia) {
                            if (activeMedia.duration) {
                                return {
                                    currentTime: activeMedia.currentTime,
                                    duration: activeMedia.duration,
                                    paused: activeMedia.paused
                                };
                            }
                        }
                        
                        // Fallback: 針對 YouTube Music 特化，使用官方公開 API
                        const ytPlayer = document.getElementById('movie_player');
                        if (ytPlayer && ytPlayer.getCurrentTime) {
                            if (ytPlayer.getVolume && Math.abs(ytPlayer.getVolume() - ${this.targetVolume} * 100) > 1) {
                                ytPlayer.setVolume(${this.targetVolume} * 100);
                            }
                            return {
                                currentTime: ytPlayer.getCurrentTime(),
                                duration: ytPlayer.getDuration(),
                                paused: ytPlayer.getPlayerState() !== 1
                            };
                        }
                        
                        return null;
                    })();
                `);
                
                if (status && this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('media-status', status);
                }
             } catch(e) {}
        }, 1000);
    }

    resizeView(view) {
        if (!this.mainWindow) return;
        const bounds = this.mainWindow.getContentBounds();
        // 頂部 38px 為 Windows 原生標題列留白，底部 80px 控制列
        view.setBounds({ x: 0, y: 38, width: bounds.width, height: bounds.height - 38 - 80 });
    }

    sendShortcut(action) {
        if (!this.activePlatform) return false;

        console.log(`[PlatformManager] Forwarding action: ${action} to ${this.activePlatform}`);

        if (this.activePlatform === 'local') {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('local-shortcut', action);
                return true;
            }
            return false;
        }

        const view = this.views[this.activePlatform];
        if (!view) return false;

        const script = this.scripts[this.activePlatform]?.[action];
        if (script) {
            view.webContents.executeJavaScript(script).catch(err => console.error("Injection failed:", err));
            return true;
        }

        return false;
    }

    seekMedia(percentage) {
        if (!this.activePlatform || this.activePlatform === 'local') return;
        const view = this.views[this.activePlatform];
        if (view && view.webContents && !view.webContents.isDestroyed()) {
             const script = `
                try {
                    let allMedia = Array.from(document.querySelectorAll('video, audio'));
                    if (window.__GUA_MEDIAS) window.__GUA_MEDIAS.forEach(m => allMedia.push(m));
                    allMedia.forEach(el => {
                        if(el.duration) el.currentTime = el.duration * (${percentage} / 100);
                    });
                    
                    // YT Music 特化 API
                    const ytPlayer = document.getElementById('movie_player');
                    if (ytPlayer && ytPlayer.getDuration) {
                        ytPlayer.seekTo(ytPlayer.getDuration() * (${percentage} / 100));
                    }
                } catch(e) {}
             `;
             view.webContents.executeJavaScript(script);
        }
    }

    setVolume(vol) {
        this.targetVolume = vol;
        if (!this.activePlatform || this.activePlatform === 'local') return;
        const view = this.views[this.activePlatform];
        if (view && view.webContents && !view.webContents.isDestroyed()) {
             const script = `
                try {
                    let allMedia = Array.from(document.querySelectorAll('video, audio'));
                    if (window.__GUA_MEDIAS) window.__GUA_MEDIAS.forEach(m => allMedia.push(m));
                    allMedia.forEach(el => { el.volume = ${vol}; });
                    
                    // YT Music 特化 API 
                    const ytPlayer = document.getElementById('movie_player');
                    if (ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(${vol} * 100);
                } catch(e) {}
             `;
             view.webContents.executeJavaScript(script);
        }
    }
}

module.exports = new PlatformManager();
