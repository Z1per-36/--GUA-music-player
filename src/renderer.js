const audioElement = document.getElementById('local-audio');
const filenameElement = document.getElementById('local-filename');
const btnPlayPause = document.getElementById('btn-play-pause');
const btnNext = document.getElementById('btn-next');
const btnPrev = document.getElementById('btn-prev');
const iconPlay = document.getElementById('icon-play');
const iconPause = document.getElementById('icon-pause');
const sourceIcons = document.querySelectorAll('.source-icon');
const localView = document.getElementById('local-view');
const defaultView = document.getElementById('default-view');
const btnSettings = document.getElementById('btn-settings');

// 進度條元件
const progressBar = document.getElementById('progress-bar');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
let currentPlatform = 'none';

// 格式化時間 (秒 -> m:ss)
function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ---- 切換平台邏輯 ----
sourceIcons.forEach(btn => {
    btn.addEventListener('click', () => {
        sourceIcons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        currentPlatform = btn.dataset.platform;
        if (currentPlatform === 'local') {
            defaultView.style.display = 'none';
            localView.style.display = 'flex';
        } else {
            defaultView.style.display = 'none';
            localView.style.display = 'none';
            timeCurrent.innerText = '0:00';
            timeTotal.innerText = '0:00';
            progressBar.value = 0;
            iconPlay.style.display = 'block';
            iconPause.style.display = 'none';
        }
        window.electronAPI.switchPlatform(currentPlatform);
        
        // 切換後立即將目前音量送給後端，後端管理器會主動同步套用到所有元件
        const currentVol = parseInt(volumeBar.value, 10) / 100;
        if (currentPlatform !== 'local' && currentPlatform !== 'none') {
            window.electronAPI.setVolume(currentVol);
        }
    });
});

// ---- 控制列圖示動作 ----
function handleShortcutCall(action) {
    if (action === 'volume-up') {
        volumeBar.value = Math.min(100, parseInt(volumeBar.value, 10) + 10);
        volumeBar.dispatchEvent(new Event('input'));
        return;
    }
    if (action === 'volume-down') {
        volumeBar.value = Math.max(0, parseInt(volumeBar.value, 10) - 10);
        volumeBar.dispatchEvent(new Event('input'));
        return;
    }

    if (currentPlatform === 'local') {
        if (action === 'play-pause') toggleLocalPlay();
        // 對於本機檔案的 next/prev 目前未做播放清單，故忽略
    } else if (currentPlatform !== 'none') {
        window.electronAPI.triggerShortcut(action);
    }
}

btnPlayPause.addEventListener('click', () => handleShortcutCall('play-pause'));
btnNext.addEventListener('click', () => handleShortcutCall('next-track'));
btnPrev.addEventListener('click', () => handleShortcutCall('prev-track'));

function toggleLocalPlay() {
    if (!audioElement.src || audioElement.src === '' || audioElement.src.includes('index.html')) return; // 防呆
    if (audioElement.paused) {
        audioElement.play();
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
    } else {
        audioElement.pause();
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
    }
}

window.electronAPI.onShortcut(handleShortcutCall);

// ---- 接收第三方平台的播放狀態 ----
window.electronAPI.onMediaStatus((status) => {
    if (currentPlatform === 'local') return; // local 有自己的 listening
    
    timeCurrent.innerText = formatTime(status.currentTime);
    timeTotal.innerText = formatTime(status.duration);
    
    const progress = (status.currentTime / status.duration) * 100;
    progressBar.value = isNaN(progress) ? 0 : progress;

    if (status.paused) {
        iconPlay.style.display = 'block';
        iconPause.style.display = 'none';
    } else {
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
    }
});

// ---- 音量控制 ----
const volumeBar = document.getElementById('volume-bar');
const btnVolume = document.getElementById('btn-volume');
const volumePopup = document.getElementById('volume-popup');
const volArc1 = document.getElementById('vol-arc-1');
const volArc2 = document.getElementById('vol-arc-2');
const volMute1 = document.getElementById('vol-mute-1');
const volMute2 = document.getElementById('vol-mute-2');
const volText = document.getElementById('volume-text');

btnVolume.addEventListener('click', (e) => {
    e.stopPropagation();
    volumePopup.classList.toggle('show');
});

document.addEventListener('click', (e) => {
    if (!volumePopup.contains(e.target) && !btnVolume.contains(e.target)) {
        volumePopup.classList.remove('show');
    }
});

volumeBar.addEventListener('input', (e) => {
    const vol = parseInt(e.target.value, 10);
    volText.textContent = `${vol}%`;
    
    // 動態音量圖示變化
    if (vol === 0) {
        volArc1.style.opacity = '0';
        volArc2.style.opacity = '0';
        volMute1.style.opacity = '1';
        volMute2.style.opacity = '1';
    } else if (vol <= 50) {
        volArc1.style.opacity = '1';
        volArc2.style.opacity = '0';
        volMute1.style.opacity = '0';
        volMute2.style.opacity = '0';
    } else {
        volArc1.style.opacity = '1';
        volArc2.style.opacity = '1';
        volMute1.style.opacity = '0';
        volMute2.style.opacity = '0';
    }

    const volFloat = vol / 100;
    
    // 更新本地音量
    audioElement.volume = volFloat;
    
    // 把音量操作傳遞給對應的平台引擎
    if (currentPlatform !== 'local' && currentPlatform !== 'none') {
        window.electronAPI.setVolume(volFloat);
    }
});

// 當拉動進度條時 (針對第三方平台)
progressBar.addEventListener('change', (e) => {
    if (currentPlatform !== 'local' && currentPlatform !== 'none') {
        window.electronAPI.seekMedia(currentPlatform, e.target.value);
    }
});

// ---- 本地檔案更新進度條 ----
audioElement.addEventListener('timeupdate', () => {
    timeCurrent.innerText = formatTime(audioElement.currentTime);
    const progress = (audioElement.currentTime / audioElement.duration) * 100;
    progressBar.value = isNaN(progress) ? 0 : progress;
});

audioElement.addEventListener('loadedmetadata', () => {
    timeTotal.innerText = formatTime(audioElement.duration);
});

progressBar.addEventListener('input', (e) => {
    if (currentPlatform === 'local' && audioElement.duration) {
        const seekTime = (e.target.value / 100) * audioElement.duration;
        audioElement.currentTime = seekTime;
    }
});

// ---- 開啟檔案與設定 ----
document.getElementById('btn-open-file').addEventListener('click', async () => {
    const filePath = await window.electronAPI.openFileDialog();
    if (filePath) {
        const fileUrl = 'file:///' + filePath.replace(/\\/g, '/');
        audioElement.src = fileUrl;
        
        const fileName = filePath.split('\\').pop().split('/').pop();
        filenameElement.innerText = fileName;
        audioElement.play();
        iconPlay.style.display = 'none';
        iconPause.style.display = 'block';
    }
});

btnSettings.addEventListener('click', () => {
    window.electronAPI.openSettings();
});
