// バックグラウンドスクリプト（Service Worker）
class SpotifyLoopBackground {
  constructor() {
    this.init();
  }

  init() {
    this.setupEventListeners();
    console.log('Spotify AB Loop バックグラウンド処理を開始しました');
  }

  setupEventListeners() {
    // 拡張機能インストール時
    chrome.runtime.onInstalled.addListener((details) => {
      this.handleInstall(details);
    });

    // 拡張機能起動時
    chrome.runtime.onStartup.addListener(() => {
      this.handleStartup();
    });

    // タブの更新を監視
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdate(tabId, changeInfo, tab);
    });

    // メッセージリスナー
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true;
    });
  }

  handleInstall(details) {
    if (details.reason === 'install') {
      console.log('Spotify AB Loop が初回インストールされました');
      this.initializeStorage();
    } else if (details.reason === 'update') {
      console.log('Spotify AB Loop がアップデートされました');
      this.handleUpdate(details.previousVersion);
    }
  }

  handleStartup() {
    console.log('Spotify AB Loop が起動しました');
  }

  handleTabUpdate(tabId, changeInfo, tab) {
    // SpotifyのページでURL変更があった場合の処理
    if (changeInfo.status === 'complete' && 
        tab.url && 
        tab.url.includes('open.spotify.com')) {
      
      console.log('Spotifyページが更新されました:', tab.url);
      
      // 少し待ってからコンテンツスクリプトに状態同期を送信
      setTimeout(async () => {
        await this.syncStateToContent(tabId);
      }, 2000); // 2秒待ってからコンテンツスクリプトが読み込まれるのを確実にする
    }
  }

  handleMessage(request, sender, sendResponse) {
    switch (request.type) {
      case 'GET_STORAGE':
        this.getStorageData(request.key)
          .then(data => sendResponse({ success: true, data }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        break;

      case 'SET_STORAGE':
        this.setStorageData(request.key, request.data)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        break;

      case 'CLEAR_STORAGE':
        this.clearStorageData(request.key)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  }

  async initializeStorage() {
    try {
      const defaultSettings = {
        loopState: {
          enabled: false,
          pointA: null,
          pointB: null,
          currentTime: 0,
          trackName: ''
        },
        preferences: {
          autoLoop: false,
          seekPrecision: 0.5,
          cooldownTime: 2000
        }
      };

      // 既存の設定がない場合のみデフォルト値を設定
      const existing = await chrome.storage.local.get(Object.keys(defaultSettings));
      const toSet = {};

      for (const [key, value] of Object.entries(defaultSettings)) {
        if (!existing[key]) {
          toSet[key] = value;
        }
      }

      if (Object.keys(toSet).length > 0) {
        await chrome.storage.local.set(toSet);
        console.log('デフォルト設定を初期化しました:', toSet);
      }
    } catch (error) {
      console.error('ストレージ初期化エラー:', error);
    }
  }

  async handleUpdate(previousVersion) {
    try {
      // バージョンアップ時のマイグレーション処理
      console.log(`${previousVersion} から更新されました`);
      
      // 必要に応じて設定の移行やクリーンアップを実行
      await this.migrateSettings(previousVersion);
    } catch (error) {
      console.error('アップデート処理エラー:', error);
    }
  }

  async migrateSettings(previousVersion) {
    const currentSettings = await chrome.storage.local.get();
    console.log('現在の設定:', currentSettings);
  }

  async getStorageData(key) {
    try {
      const result = await chrome.storage.local.get(key);
      return key ? result[key] : result;
    } catch (error) {
      console.error('ストレージ読み込みエラー:', error);
      throw error;
    }
  }

  async setStorageData(key, data) {
    try {
      await chrome.storage.local.set({ [key]: data });
      console.log(`ストレージに保存しました: ${key}`);
    } catch (error) {
      console.error('ストレージ保存エラー:', error);
      throw error;
    }
  }

  async clearStorageData(key) {
    try {
      if (key) {
        await chrome.storage.local.remove(key);
        console.log(`ストレージをクリアしました: ${key}`);
      } else {
        await chrome.storage.local.clear();
        console.log('全ストレージをクリアしました');
      }
    } catch (error) {
      console.error('ストレージクリアエラー:', error);
      throw error;
    }
  }

  async syncStateToContent(tabId) {
    try {
      console.log(`🔄 タブ${tabId}にループ状態を自動同期中...`);
      
      // ストレージからループ状態を読み込み
      const result = await chrome.storage.local.get(['loopState']);
      if (!result.loopState) {
        console.log('⚠️ 保存されたループ状態がありません');
        return;
      }
      
      const loopState = result.loopState;
      console.log('📊 復元するループ状態:', loopState);
      
      // ループが有効、かつA・B点が設定されている場合のみ同期
      if (loopState.enabled && loopState.pointA !== null && loopState.pointB !== null) {
        // content.jsにINIT_STATEメッセージを送信
        const response = await chrome.tabs.sendMessage(tabId, {
          type: 'INIT_STATE',
          state: {
            enabled: loopState.enabled,
            pointA: loopState.pointA,
            pointB: loopState.pointB
          }
        });
        
        if (response && response.success) {
          console.log('✅ 自動状態同期完了 - ポップアップ不要でABループが復元されました');
        } else {
          console.log('⚠️ 自動状態同期失敗');
        }
      } else {
        console.log('⚠️ ループ無効または未設定のため同期スキップ');
      }
    } catch (error) {
      console.log('❌ 自動状態同期エラー:', error.message);
    }
  }
}

// バックグラウンドスクリプトを初期化
new SpotifyLoopBackground();