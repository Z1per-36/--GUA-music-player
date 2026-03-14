const { WebContentsView } = require('electron');

class PlatformManager {
    constructor() {
        this.activePlatform = null;
        this.views = {};
        this.mainWindow = null; 
        
        this.urls = {
            ytmusic: 'https://music.youtube.com/',
            spotify: 'https://open.spotify.com/',
            soundcloud: 'https://soundcloud.com/'
        };

        this.scripts = {
            ytmusic: {
                'play-pause': "document.querySelector('#play-pause-button')?.click()",
                'next-track': "document.querySelector('.next-button')?.click()",
                'prev-track': "document.querySelector('.previous-button')?.click()"
            },
            spotify: {
                'play-pause': "document.querySelector('[data-testid=\"control-button-playpause\"]')?.click()",
                'next-track': "document.querySelector('[data-testid=\"control-button-skip-forward\"]')?.click()",
                'prev-track': "document.querySelector('[data-testid=\"control-button-skip-back\"]')?.click()"
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
                    backgroundThrottling: true, 
                }
            });
            
            const cleanUserAgent = view.webContents.userAgent.replace(/Electron\/\S+\s/g, '');
            view.webContents.userAgent = cleanUserAgent;
            
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
                        let audio = document.querySelector('video') || document.querySelector('audio');
                        if (!audio) return null;
                        return {
                            currentTime: audio.currentTime,
                            duration: audio.duration,
                            paused: audio.paused
                        };
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
                    let audio = document.querySelector('video') || document.querySelector('audio');
                    if(audio && audio.duration) {
                        audio.currentTime = audio.duration * (${percentage} / 100);
                    }
                } catch(e) {}
             `;
             view.webContents.executeJavaScript(script);
        }
    }

    setVolume(vol) {
        if (!this.activePlatform || this.activePlatform === 'local') return;
        const view = this.views[this.activePlatform];
        if (view && view.webContents && !view.webContents.isDestroyed()) {
             const script = `
                try {
                    let audio = document.querySelector('video') || document.querySelector('audio');
                    if(audio) audio.volume = ${vol};
                } catch(e) {}
             `;
             view.webContents.executeJavaScript(script);
        }
    }
}

module.exports = new PlatformManager();
