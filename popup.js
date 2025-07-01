class SpotifyLoopPopup {
  constructor() {
    this.currentTab = null;
    this.loopState = {
      enabled: false,
      pointA: null,
      pointB: null,
      currentTime: 0,
      trackName: ''
    };
    
    this.init();
  }

  async init() {
    await this.getCurrentTab();
    await this.loadStoredState();
    this.setupEventListeners();
    this.updateUI();
    
    await this.syncStateToContent();
    
    this.startStatusUpdates();
  }

  async getCurrentTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    this.currentTab = tab;
  }

  async loadStoredState() {
    try {
      const result = await chrome.storage.local.get(['loopState']);
      if (result.loopState) {
        this.loopState = { ...this.loopState, ...result.loopState };
      }
    } catch (error) {
      console.error('状態の読み込みエラー:', error);
    }
  }

  async saveState() {
    try {
      await chrome.storage.local.set({ loopState: this.loopState });
    } catch (error) {
      console.error('状態の保存エラー:', error);
    }
  }

  setupEventListeners() {
    // ループ切り替え
    document.getElementById('loop-enabled').addEventListener('change', (e) => {
      this.loopState.enabled = e.target.checked;
      this.saveState();
      this.sendMessageToContent({ type: 'TOGGLE_LOOP', enabled: this.loopState.enabled });
    });

    // A点設定
    document.getElementById('set-point-a').addEventListener('click', async () => {
      const response = await this.sendMessageToContent({ type: 'GET_CURRENT_TIME' });
      if (response && response.time !== undefined) {
        this.loopState.pointA = response.time;
        this.saveState();
        this.updateUI();
        this.sendMessageToContent({ 
          type: 'SET_LOOP_POINTS', 
          pointA: this.loopState.pointA, 
          pointB: this.loopState.pointB 
        });
      }
    });

    // B点設定
    document.getElementById('set-point-b').addEventListener('click', async () => {
      const response = await this.sendMessageToContent({ type: 'GET_CURRENT_TIME' });
      if (response && response.time !== undefined) {
        this.loopState.pointB = response.time;
        this.saveState();
        this.updateUI();
        this.sendMessageToContent({ 
          type: 'SET_LOOP_POINTS', 
          pointA: this.loopState.pointA, 
          pointB: this.loopState.pointB 
        });
      }
    });

    // ポイントクリア
    document.getElementById('clear-points').addEventListener('click', () => {
      this.loopState.pointA = null;
      this.loopState.pointB = null;
      this.saveState();
      this.updateUI();
      this.sendMessageToContent({ type: 'CLEAR_LOOP_POINTS' });
    });

    // A点へジャンプ
    document.getElementById('jump-to-a').addEventListener('click', () => {
      if (this.loopState.pointA !== null) {
        this.sendMessageToContent({ type: 'JUMP_TO_TIME', time: this.loopState.pointA });
      }
    });
  }

  async sendMessageToContent(message) {
    try {
      if (!this.currentTab || !this.currentTab.id) {
        return null;
      }
      
      const response = await chrome.tabs.sendMessage(this.currentTab.id, message);
      return response;
    } catch (error) {
      console.error('コンテンツスクリプトとの通信エラー:', error);
      return null;
    }
  }

  updateUI() {
    // ループ状態
    document.getElementById('loop-enabled').checked = this.loopState.enabled;
    
    // A点時間
    const pointAElement = document.getElementById('point-a-time');
    pointAElement.textContent = this.loopState.pointA !== null 
      ? this.formatTime(this.loopState.pointA) 
      : '未設定';
    
    // B点時間
    const pointBElement = document.getElementById('point-b-time');
    pointBElement.textContent = this.loopState.pointB !== null 
      ? this.formatTime(this.loopState.pointB) 
      : '未設定';
    
    // 現在時間
    document.getElementById('current-time').textContent = this.formatTime(this.loopState.currentTime);
    
    // トラック名
    document.getElementById('track-name').textContent = this.loopState.trackName || '検出中...';
    
    // ループ範囲
    const loopDuration = this.calculateLoopDuration();
    document.getElementById('loop-duration').textContent = loopDuration;
    
    // ボタンの有効/無効状態
    const jumpButton = document.getElementById('jump-to-a');
    jumpButton.disabled = this.loopState.pointA === null;
    jumpButton.style.opacity = this.loopState.pointA === null ? '0.5' : '1';
  }

  calculateLoopDuration() {
    if (this.loopState.pointA !== null && this.loopState.pointB !== null) {
      const duration = Math.abs(this.loopState.pointB - this.loopState.pointA);
      return this.formatTime(duration);
    }
    return '--';
  }

  formatTime(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds)) {
      return '--:--';
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  async syncStateToContent() {
    try {
      console.log('🔄 content.jsに状態を同期中...', this.loopState);
      
      // INIT_STATEメッセージで現在の状態を送信
      const response = await this.sendMessageToContent({ 
        type: 'INIT_STATE', 
        state: {
          enabled: this.loopState.enabled,
          pointA: this.loopState.pointA,
          pointB: this.loopState.pointB
        }
      });
      
      if (response && response.success) {
        console.log('✅ content.jsとの状態同期完了');
      } else {
        console.log('⚠️ content.jsとの状態同期失敗');
      }
    } catch (error) {
      console.log('❌ 状態同期エラー:', error.message);
    }
  }

  async startStatusUpdates() {
    // 定期的にSpotifyの状態を取得
    setInterval(async () => {
      const response = await this.sendMessageToContent({ type: 'GET_STATUS' });
      if (response) {
        let shouldUpdate = false;
        
        if (response.currentTime !== undefined) {
          this.loopState.currentTime = response.currentTime;
          shouldUpdate = true;
        }
        
        if (response.trackName && response.trackName !== this.loopState.trackName) {
          this.loopState.trackName = response.trackName;
          shouldUpdate = true;
        }
        
        if (shouldUpdate) {
          this.updateUI();
        }
      }
    }, 1000);
  }
}

// ポップアップが開かれたときに初期化
document.addEventListener('DOMContentLoaded', () => {
  new SpotifyLoopPopup();
});