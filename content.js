class SpotifyABLoop {
  constructor() {
    this.loopEnabled = false;
    this.pointA = null;
    this.pointB = null;
    this.monitoringInterval = null;
    this.lastSeekTime = 0;
    this.seekCooldown = 3000; 
    this.lastSeekTarget = null; 
    
    this.init();
  }

  init() {
    this.setupMessageListener();
    this.waitForSpotifyPlayer();
    this.injectControlButtons();
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; 
    });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      console.log(`📬 メッセージ受信: ${request.type}`, request);
      
      switch (request.type) {
        case 'GET_CURRENT_TIME':
          const currentTime = this.getCurrentTime();
          sendResponse({ time: currentTime });
          break;
          
        case 'GET_STATUS':
          const status = {
            currentTime: this.getCurrentTime(),
            trackName: this.getCurrentTrackName(),
            isPlaying: this.isPlaying()
          };
          sendResponse(status);
          break;
          
        case 'TOGGLE_LOOP':
          console.log(`🔄 TOGGLE_LOOPメッセージ: enabled=${request.enabled}`);
          this.toggleLoop(request.enabled);
          sendResponse({ success: true });
          break;
          
        case 'SET_LOOP_POINTS':
          console.log(`📍 SET_LOOP_POINTSメッセージ: A=${request.pointA}, B=${request.pointB}`);
          this.setLoopPoints(request.pointA, request.pointB);
          sendResponse({ success: true });
          break;
          
        case 'CLEAR_LOOP_POINTS':
          this.clearLoopPoints();
          sendResponse({ success: true });
          break;
          
        case 'JUMP_TO_TIME':
          const jumped = this.jumpToTime(request.time);
          sendResponse({ success: jumped });
          break;
          
        case 'INIT_STATE':
          console.log(`🔄 初期化メッセージ受信:`, request.state);
          this.initializeFromPopup(request.state);
          sendResponse({ success: true });
          break;
          
        default:
          sendResponse({ error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('メッセージ処理エラー:', error);
      sendResponse({ error: error.message });
    }
  }

  waitForSpotifyPlayer() {
    const checkPlayer = () => {
      const progressBar = this.getProgressBar();
      if (progressBar) {
        console.log('Spotify プレイヤーが見つかりました');
        this.startMonitoring();
      } else {
        setTimeout(checkPlayer, 1000);
      }
    };
    checkPlayer();
  }

  getProgressBar() {
    const selectors = [
      '[data-testid="progress-bar"]',
      '.progress-bar',
      '[role="progressbar"]',
      'input[type="range"]'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }
    return null;
  }

  getCurrentTimeElement() {
    const selectors = [
      '[data-testid="playback-position"]',
      '.playback-bar__progress-time-elapsed'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element;
      }
    }
    return null;
  }

  getCurrentTime() {
    try {
      const timeElement = this.getCurrentTimeElement();
      if (!timeElement) return 0;
      
      const timeText = timeElement.textContent.trim();
      const time = this.parseTimeString(timeText);
      return isNaN(time) ? 0 : time;
    } catch (error) {
      console.error('getCurrentTime エラー:', error);
      return 0;
    }
  }

  parseTimeString(timeString) {
    try {
      if (!timeString || typeof timeString !== 'string') return 0;
      
      const parts = timeString.split(':');
      if (parts.length === 2) {
        const minutes = parseInt(parts[0], 10) || 0;
        const seconds = parseInt(parts[1], 10) || 0;
        return minutes * 60 + seconds;
      }
      return 0;
    } catch (error) {
      console.error('parseTimeString エラー:', error);
      return 0;
    }
  }

  getCurrentTrackName() {
    // 現在のトラック名を取得
    const selectors = [
      '[data-testid="context-item-link"]',
      '[data-testid="context-item-info-title"]',
      '.Root__now-playing-widget .track-info__name a',
      '.now-playing .track-info__name'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }
    return 'Unknown Track';
  }

  isPlaying() {
    // 再生中かどうかを判定
    const playButton = document.querySelector('[data-testid="control-button-playpause"]');
    if (playButton) {
      const ariaLabel = playButton.getAttribute('aria-label');
      
      const pauseKeywords = ['Pause', '一時停止', 'Pausar', 'Pausieren', 'Pause', 'Приостановить'];
      const isPlaying = ariaLabel && pauseKeywords.some(keyword => ariaLabel.includes(keyword));
      
      console.log(`🎵 再生状態: ${isPlaying ? '再生中' : '停止中'} (aria-label: "${ariaLabel}")`);
      return isPlaying;
    }
    console.log('❌ 再生ボタンが見つかりません');
    return false;
  }

  jumpToTime(targetTime) {
    try {
      console.log(`${targetTime}秒にジャンプを試行中...`);
      
      const progressBar = this.getProgressBar();
      if (!progressBar) {
        console.error('プログレスバー要素が見つかりません');
        return false;
      }

      const totalDuration = this.getTotalDuration();
      if (totalDuration <= 0) {
        console.error('総再生時間が取得できません:', totalDuration);
        return false;
      }

      console.log(`総再生時間: ${totalDuration}秒`);

      const directValueSuccess = this.tryDirectValueSeek(targetTime, totalDuration);
      if (directValueSuccess) {
        console.log('✅ 直接value設定でシーク成功');
        this.lastSeekTime = Date.now();
        this.lastSeekTarget = targetTime; // シーク目標時間を記録
        setTimeout(() => this.verifySeekSuccess(targetTime), 1500);
        return true;
      }
      console.log('⚠️ 直接value設定失敗、監視は継続');
      
      this.lastSeekTime = Date.now();
      this.lastSeekTarget = targetTime; // シーク目標時間を記録
      
      // シーク成功の確認
      setTimeout(() => {
        this.verifySeekSuccess(targetTime);
      }, 1500);

      return false;
    } catch (error) {
      console.error('ジャンプエラー:', error);
      return false;
    }
  }

  getTotalDuration() {
    const selectors = [
      '[data-testid="playback-duration"]',
      '.playback-bar__progress-time-total'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return this.parseTimeString(element.textContent.trim());
      }
    }
    return 0;
  }

  tryDirectValueSeek(targetTime, totalDuration) {
    const progressBar = this.getProgressBar();
    if (!progressBar) return false;

    const milliseconds = targetTime * 1000;
    let success = false;

    // プログレスバー周辺のinput要素を探してvalue設定
    const parent = progressBar.parentElement;
    if (parent) {
      const inputs = parent.querySelectorAll('input[type="range"]');
      inputs.forEach((input, index) => {
        try {
          const maxValue = parseFloat(input.max) || 100;
          
          // 値の形式を判定してvalue設定
          let newValue;
          if (maxValue > 1000) {
            // ミリ秒形式
            newValue = milliseconds;
          } else {
            // 比例計算
            newValue = (targetTime / totalDuration) * maxValue;
          }
          
          input.value = newValue;
          
          // 必要なイベントを発火
          ['input', 'change'].forEach(eventType => {
            input.dispatchEvent(new Event(eventType, { bubbles: true }));
          });
          
          console.log(`input[${index}] value設定: ${newValue} (max: ${maxValue})`);
          success = true;
        } catch (error) {
          console.log(`input[${index}] 設定失敗:`, error.message);
        }
      });
    }

    return success;
  }


  verifySeekSuccess(targetTime) {
    const currentTime = this.getCurrentTime();
    const timeDiff = Math.abs(currentTime - targetTime);
    
    if (timeDiff <= 2) {
      console.log(`✅ シーク成功！ 目標: ${targetTime}秒, 現在: ${currentTime}秒`);
    } else {
      console.log(`⚠️ シーク誤差: 目標: ${targetTime}秒, 現在: ${currentTime}秒`);
    }
  }

  toggleLoop(enabled) {
    console.log(`📨 toggleLoop関数が呼ばれました: enabled=${enabled}`);
    console.log(`📊 現在の内部状態: loopEnabled=${this.loopEnabled}, A点=${this.pointA}, B点=${this.pointB}`);
    
    this.loopEnabled = enabled;
    console.log(`🔄 ABループ: ${enabled ? '有効' : '無効'} (更新後: loopEnabled=${this.loopEnabled})`);
    
    // ループ無効化時はA・B点も完全クリア
    if (!enabled) {
      this.pointA = null;
      this.pointB = null;
      console.log('🗑️ ポップアップでループ無効化、A・B点もクリア');
      this.updateAllPointButtons();
      this.updateLoopButtonState();
    }
    
    if (enabled) {
      console.log('✅ 監視開始を要求');
      this.startMonitoring();
    } else {
      console.log('⏹️ 監視停止を要求');
      this.stopMonitoring();
    }
  }

  setLoopPoints(pointA, pointB) {
    console.log(`📍 setLoopPoints関数が呼ばれました: A=${pointA}, B=${pointB}`);
    console.log(`📊 設定前の状態: A点=${this.pointA}, B点=${this.pointB}`);
    
    this.pointA = pointA;
    this.pointB = pointB;
    
    console.log(`✅ ループポイント設定完了: A=${this.pointA}秒, B=${this.pointB}秒`);
  }

  clearLoopPoints() {
    this.pointA = null;
    this.pointB = null;
    console.log('ループポイントをクリアしました');
  }

  initializeFromPopup(state) {
    console.log(`🔄 ポップアップからの状態で初期化開始`);
    console.log(`📊 受信した状態:`, state);
    
    // ループポイントを設定
    if (state.pointA !== null && state.pointB !== null) {
      this.pointA = state.pointA;
      this.pointB = state.pointB;
      console.log(`✅ ループポイント復元: A=${this.pointA}秒, B=${this.pointB}秒`);
    }
    
    // ループ有効状態を設定
    if (state.enabled) {
      this.loopEnabled = true;
      console.log(`✅ ループ有効状態復元: ${this.loopEnabled}`);
      this.startMonitoring();
    } else {
      this.loopEnabled = false;
      this.stopMonitoring();
    }
    
    // ボタンの状態を更新
    this.updateLoopButtonState();
    this.updateAllPointButtons();
    
    console.log(`🎯 初期化完了: ループ=${this.loopEnabled}, A=${this.pointA}, B=${this.pointB}`);
  }

  startMonitoring() {
    if (this.monitoringInterval) {
      console.log('⚠️ 既にループ監視が動作中です');
      return;
    }
    
    this.monitoringInterval = setInterval(() => {
      this.checkLoopCondition();
    }, 100); // 0.1秒間隔でチェック
    
    console.log('✅ ループ監視を開始しました (0.1秒間隔)');
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('ループ監視を停止しました');
    }
  }

  checkLoopCondition() {
    console.log(`⏱️ ループチェック実行中... (0.1秒間隔)`);
    
    // 基本的な条件チェック
    if (!this.loopEnabled) {
      console.log('❌ ループ無効');
      return;
    }
    
    if (!this.isPlaying()) {
      console.log('❌ 再生停止中');
      return;
    }
    
    if (this.pointA === null || this.pointB === null) {
      console.log('❌ A点またはB点未設定');
      return;
    }
    
    // 最近シークした場合はスキップ（無限ループ防止）
    const timeSinceLastSeek = Date.now() - this.lastSeekTime;
    if (timeSinceLastSeek < this.seekCooldown) {
      console.log(`❌ クールダウン中: ${timeSinceLastSeek}ms`);
      return;
    }
    
    const currentTime = this.getCurrentTime();
    const startPoint = Math.min(this.pointA, this.pointB);
    const endPoint = Math.max(this.pointA, this.pointB);
    
    console.log(`✅ 条件OK - 現在${currentTime}秒, A点${startPoint}秒, B点${endPoint}秒`);
    
    // 最後のシーク目標が現在のA点で、現在時刻がまだA点付近にいる場合はスキップ
    // （シーク直後の時間表示遅延による重複シークを防止）
    if (this.lastSeekTarget === startPoint) {
      const timeFromTarget = Math.abs(currentTime - startPoint);
      if (timeFromTarget <= 3) { // A点から3秒以内にいる場合
        console.log(`⏸️ 最近A点にシークしたため、重複シークを防止 (現在${currentTime}秒, 目標${startPoint}秒)`);
        return;
      }
    }
    
    // B点を超えたらA点に戻る
    if (currentTime >= endPoint) {
      console.log(`🎯 B点(${endPoint}秒)到達!A点(${startPoint}秒)に戻ります`);
      this.jumpToTime(startPoint);
    }
    
    // A点より前にいる場合もA点に移動
    else if (currentTime < startPoint) {
      console.log(`⬅️ A点より前にいます。A点に移動`);
      this.jumpToTime(startPoint);
    }
  }

  injectControlButtons() {
    // 既存のボタンがある場合は削除
    const existingButtons = document.querySelectorAll('.spotify-ab-loop-btn');
    existingButtons.forEach(btn => btn.remove());

    // コントロールバーを探す
    const waitForControls = () => {
      const controlsContainer = this.findControlsContainer();
      if (controlsContainer) {
        console.log('✅ コントロールバーが見つかりました、A・Bボタンを追加中...');
        this.createABButtons();
      } else {
        console.log('⏳ コントロールバーを待機中...');
        setTimeout(waitForControls, 1000);
      }
    };
    
    waitForControls();
  }

  findControlsContainer() {
    // Spotifyのコントロールバーを探すためのセレクター
    const selectors = [
      '[data-testid="player-controls"]',
      '.player-controls',
      '.Root__now-playing-bar .player-controls',
      '.now-playing-bar .player-controls',
      '[class*="player-controls"]'
    ];

    for (const selector of selectors) {
      const container = document.querySelector(selector);
      if (container) {
        console.log(`コントロールコンテナ発見: ${selector}`);
        return container;
      }
    }

    // 代替: シャッフルボタンとリピートボタンの親要素を探す
    const shuffleBtn = document.querySelector('[data-testid="control-button-shuffle"]');
    const repeatBtn = document.querySelector('[data-testid="control-button-repeat"]');
    
    if (shuffleBtn && repeatBtn) {
      // 共通の親要素を見つける
      let parent = shuffleBtn.parentElement;
      while (parent && !parent.contains(repeatBtn)) {
        parent = parent.parentElement;
      }
      if (parent) {
        console.log('シャッフル・リピートボタンの親要素を使用');
        return parent;
      }
    }

    return null;
  }

  createABButtons() {
    // シャッフルボタンとリピートボタンを探す
    const shuffleBtn = document.querySelector('[data-testid="control-button-shuffle"]');
    const repeatBtn = document.querySelector('[data-testid="control-button-repeat"]');

    if (!shuffleBtn || !repeatBtn) {
      console.log('⚠️ シャッフルまたはリピートボタンが見つかりません');
      return;
    }

    // Aボタンを作成（シャッフルボタンの左に配置）
    const aButton = this.createPointButton('A', () => this.setPointFromButton('A'));
    
    // Bボタンを作成（リピートボタンの右に配置）
    const bButton = this.createPointButton('B', () => this.setPointFromButton('B'));

    // ループ切り替えボタンを作成（再生バー右側に配置）
    const loopToggleButton = this.createLoopToggleButton();

    // ボタンを配置
    shuffleBtn.parentNode.insertBefore(aButton, shuffleBtn);
    repeatBtn.parentNode.insertBefore(bButton, repeatBtn.nextSibling);
    
    // ループ切り替えボタンを右側に配置
    this.addLoopToggleToRightSide(loopToggleButton);

    console.log('✅ A・B・ループ切り替えボタンを追加しました');
  }

  createPointButton(pointType, clickHandler) {
    const button = document.createElement('button');
    button.className = `spotify-ab-loop-btn spotify-${pointType.toLowerCase()}-btn`;
    button.onclick = clickHandler;
    
    // 初期表示の設定
    this.updatePointButtonDisplay(button, pointType);
    
    // Spotifyのボタンスタイルに合わせる（時間表示対応で幅を広げる）
    button.style.cssText = `
      background: transparent;
      border: none;
      color: #b3b3b3;
      cursor: pointer;
      font-size: 11px;
      font-weight: bold;
      padding: 4px 8px;
      margin: 0 2px;
      border-radius: 16px;
      min-width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s, background-color 0.2s;
      font-family: 'Spotify Circular', sans-serif;
      white-space: nowrap;
    `;

    // ホバー効果
    button.addEventListener('mouseenter', () => {
      const isSet = (pointType === 'A' && this.pointA !== null) || (pointType === 'B' && this.pointB !== null);
      if (!isSet) {
        button.style.color = '#fff';
      }
      button.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    });

    button.addEventListener('mouseleave', () => {
      const isSet = (pointType === 'A' && this.pointA !== null) || (pointType === 'B' && this.pointB !== null);
      button.style.color = isSet ? '#1ed760' : '#b3b3b3';
      button.style.backgroundColor = 'transparent';
    });

    return button;
  }

  updatePointButtonDisplay(button, pointType) {
    const point = pointType === 'A' ? this.pointA : this.pointB;
    const isSet = point !== null;
    
    if (isSet) {
      // 設定済み：緑色で時間表示
      button.textContent = `${pointType}:${this.formatTime(point)}`;
      button.style.color = '#1ed760';
      button.title = `${pointType}点: ${this.formatTime(point)} (クリックでクリア)`;
    } else {
      // 未設定：グレーで文字のみ
      button.textContent = pointType;
      button.style.color = '#b3b3b3';
      button.title = `${pointType}点を設定`;
    }
  }

  formatTime(seconds) {
    if (seconds === null || seconds === undefined || isNaN(seconds)) {
      return '--:--';
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  async setPointFromButton(point) {
    const currentTime = this.getCurrentTime();
    const currentPoint = point === 'A' ? this.pointA : this.pointB;
    
    if (currentPoint !== null) {
      // 既に設定済みの場合はクリア
      if (point === 'A') {
        this.pointA = null;
        console.log(`🅰️ A点をクリア`);
      } else {
        this.pointB = null;
        console.log(`🅱️ B点をクリア`);
      }
      
      // ループが有効だった場合は無効化
      if (this.loopEnabled) {
        this.loopEnabled = false;
        this.stopMonitoring();
        this.updateLoopButtonState();
        console.log('⏹️ ポイントクリアによりループ無効化');
      }
    } else {
      // 未設定の場合は設定
      if (point === 'A') {
        this.pointA = currentTime;
        console.log(`🅰️ A点を設定: ${currentTime}秒`);
      } else {
        this.pointB = currentTime;
        console.log(`🅱️ B点を設定: ${currentTime}秒`);
      }
      
      // 両方のポイントが設定されたら自動的にループを有効化
      if (this.pointA !== null && this.pointB !== null) {
        this.loopEnabled = true;
        this.startMonitoring();
        this.updateLoopButtonState();
        console.log('✅ A・B点両方設定完了、自動でループ有効化');
      }
    }

    // ボタンの表示を更新
    this.updateAllPointButtons();
    
    // ストレージに保存
    await this.saveLoopState();
  }

  updateAllPointButtons() {
    const aBtn = document.querySelector('.spotify-a-btn');
    const bBtn = document.querySelector('.spotify-b-btn');
    
    if (aBtn) {
      this.updatePointButtonDisplay(aBtn, 'A');
    }
    if (bBtn) {
      this.updatePointButtonDisplay(bBtn, 'B');
    }
  }

  async saveLoopState() {
    try {
      const loopState = {
        enabled: this.loopEnabled,
        pointA: this.pointA,
        pointB: this.pointB,
        currentTime: this.getCurrentTime(),
        trackName: this.getCurrentTrackName()
      };
      await chrome.storage.local.set({ loopState });
      console.log('💾 ループ状態を保存しました');
    } catch (error) {
      console.error('ループ状態保存エラー:', error);
    }
  }

  createLoopToggleButton() {
    const button = document.createElement('button');
    button.className = 'spotify-ab-loop-toggle-btn';
    button.title = 'ABループ切り替え';
    
    // ABアイコンを使用
    button.innerHTML = 'AB';
    
    // 基本スタイル（Spotifyのボタンに合わせる）
    button.style.cssText = `
      background: transparent;
      border: none;
      color: ${this.loopEnabled ? '#1ed760' : '#b3b3b3'};
      cursor: pointer;
      font-size: 12px;
      font-weight: bold;
      padding: 8px;
      margin: 0 4px;
      border-radius: 50%;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.2s, background-color 0.2s;
      font-family: 'Spotify Circular', sans-serif;
    `;

    // クリックイベント
    button.onclick = () => this.toggleLoopFromButton();

    // ホバー効果
    button.addEventListener('mouseenter', () => {
      if (!this.loopEnabled) {
        button.style.color = '#fff';
      }
      button.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
    });

    button.addEventListener('mouseleave', () => {
      button.style.color = this.loopEnabled ? '#1ed760' : '#b3b3b3';
      button.style.backgroundColor = 'transparent';
    });

    return button;
  }

  addLoopToggleToRightSide(loopButton) {
    // 再生バー右側のコントロール領域を探す
    const rightControls = this.findRightControlsArea();
    
    if (rightControls) {
      // 最初の子要素の前に挿入（一番左に配置）
      if (rightControls.firstChild) {
        rightControls.insertBefore(loopButton, rightControls.firstChild);
      } else {
        rightControls.appendChild(loopButton);
      }
      console.log('✅ ループ切り替えボタンを右側に配置しました');
    } else {
      // 代替: メインのコントロールエリア右端に配置
      const mainControls = document.querySelector('[data-testid="player-controls"]');
      if (mainControls) {
        mainControls.appendChild(loopButton);
        console.log('⚠️ 代替位置にループ切り替えボタンを配置しました');
      }
    }
  }

  findRightControlsArea() {
    // 右側のコントロールエリアを探すセレクター
    const selectors = [
      '.Root__now-playing-bar .extra-controls',
      '.now-playing-bar .extra-controls',
      '[class*="extra-controls"]',
      '[class*="right-controls"]',
      '.player-controls-right',
      '[data-testid="extra-controls"]'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        console.log(`右側コントロールエリア発見: ${selector}`);
        return element;
      }
    }

    // 代替: 音量コントロールの親要素を探す
    const volumeBtn = document.querySelector('[data-testid="volume-bar"]');
    if (volumeBtn) {
      let parent = volumeBtn.parentElement;
      while (parent && parent.tagName !== 'BODY') {
        // 複数のコントロール要素を含む親を探す
        if (parent.children.length > 1) {
          console.log('音量コントロールの親要素を使用');
          return parent;
        }
        parent = parent.parentElement;
      }
    }

    return null;
  }

  toggleLoopFromButton() {
    this.loopEnabled = !this.loopEnabled;
    console.log(`🔄 ループ切り替え: ${this.loopEnabled ? '有効' : '無効'}`);
    
    // ループ無効化時はA・B点も完全クリア
    if (!this.loopEnabled) {
      this.pointA = null;
      this.pointB = null;
      console.log('🗑️ ループ無効化でA・B点もクリア');
      this.updateAllPointButtons();
    }
    
    // ボタンの色を更新
    const loopBtn = document.querySelector('.spotify-ab-loop-toggle-btn');
    if (loopBtn) {
      loopBtn.style.color = this.loopEnabled ? '#1ed760' : '#b3b3b3';
    }
    
    // ループの開始/停止
    if (this.loopEnabled && this.pointA !== null && this.pointB !== null) {
      this.startMonitoring();
      console.log('✅ ループ監視開始');
    } else {
      this.stopMonitoring();
      console.log('⏹️ ループ監視停止');
    }
    
    // 状態を保存
    this.saveLoopState();
    
    // 視覚的フィードバック
    if (loopBtn) {
      const originalColor = loopBtn.style.color;
      loopBtn.style.color = this.loopEnabled ? '#1ed760' : '#ff6b6b';
      setTimeout(() => {
        loopBtn.style.color = originalColor;
      }, 200);
    }
  }

  // ループ状態が変更された時にボタンの色を更新する関数
  updateLoopButtonState() {
    const loopBtn = document.querySelector('.spotify-ab-loop-toggle-btn');
    if (loopBtn) {
      loopBtn.style.color = this.loopEnabled ? '#1ed760' : '#b3b3b3';
    }
  }
}

// DOM読み込み完了後に初期化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new SpotifyABLoop();
  });
} else {
  new SpotifyABLoop();
}