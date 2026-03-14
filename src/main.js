const { app, BrowserWindow, globalShortcut, ipcMain, dialog } = require('electron');
const path = require('path');
const platformManager = require('./platformManager');

// 啟用降低記憶體佔用的命令列開關
app.commandLine.appendSwitch('disable-site-isolation-trials');

let mainWindow;
let settingsWindow;
let currentShortcuts = {
  'play-pause': 'CommandOrControl+Shift+Space',
  'next-track': 'CommandOrControl+Shift+Right',
  'prev-track': 'CommandOrControl+Shift+Left'
};

function registerShortcuts() {
  globalShortcut.unregisterAll();
  Object.entries(currentShortcuts).forEach(([action, keys]) => {
    if (!keys) return;
    try {
      globalShortcut.register(keys, () => {
        console.log(`Global shortcut ${keys} triggered: ${action}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('shortcut', action);
        }
        platformManager.sendShortcut(action);
      });
    } catch (e) {
      console.error(`Failed to register shortcut: ${keys}`, e);
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    titleBarStyle: 'hidden', // 隱藏預設標題列但保留內容區域
    titleBarOverlay: {       // 啟用 Windows 11 原生控制按鈕 (視窗化/縮小/關閉)
        color: 'rgba(0,0,0,0)', // 全透明背景，完美透出底下 Mica 材質
        symbolColor: '#ffffff', 
        height: 38
    },
    backgroundMaterial: 'mica', // Windows 11 專屬毛玻璃材質
    autoHideMenuBar: true,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  platformManager.setMainWindow(mainWindow);

  registerShortcuts();

  ipcMain.on('update-shortcuts', (event, shortcuts) => {
    currentShortcuts = shortcuts;
    registerShortcuts();
    console.log('Shortcuts updated successfully:', currentShortcuts);
  });

  ipcMain.handle('get-shortcuts', () => {
    return currentShortcuts;
  });

  // 收發 WebContentsView 傳來的播放進度，轉發給 main renderer
  ipcMain.on('media-status', (event, status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('media-status', status);
    }
  });

  ipcMain.on('seek-media', (event, {platformId, percentage}) => {
      platformManager.seekMedia(percentage);
  });

  ipcMain.on('trigger-shortcut', (event, action) => {
      platformManager.sendShortcut(action);
  });
  
  ipcMain.on('set-volume', (event, vol) => {
      platformManager.setVolume(vol);
  });

  ipcMain.on('open-settings', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.focus();
        return;
    }
    settingsWindow = new BrowserWindow({
        width: 480,
        height: 520,
        parent: mainWindow,
        modal: false,
        autoHideMenuBar: true,
        backgroundMaterial: 'mica',
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: 'rgba(0,0,0,0)', symbolColor: '#ffffff', height: 38 },
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });
    settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  });

  ipcMain.on('close-settings', () => {
      if (settingsWindow && !settingsWindow.isDestroyed()) {
          settingsWindow.close();
      }
  });

  ipcMain.on('switch-platform', (event, platformId) => {
    platformManager.switchPlatform(platformId);
    console.log(`UI requested platform switch: ${platformId}`);
  });

  ipcMain.handle('open-file-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Select Music File',
        filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac'] }],
        properties: ['openFile']
    });
    if (!canceled && filePaths.length > 0) {
        return filePaths[0]; // Return the file path to renderer
    }
    return null;
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
