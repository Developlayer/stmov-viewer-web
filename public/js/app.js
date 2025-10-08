/**
 * Minimal STMOV Viewer Application
 * Basic 3D point cloud playback with essential controls only
 */

/**
 * パフォーマンス設定の定数
 */
class PerformanceConfig {
    // フレームレート関連
    static TARGET_FPS = 30;                                    // 目標FPS
    static TARGET_FRAME_TIME_MS = 33.333;                      // 33.3ms (1フレームの目標時間 = 1000/30)

    // パフォーマンス閾値
    static SLOW_THRESHOLD_MS = 35.0;      // これを超えたら「遅い」と判断
    static FAST_THRESHOLD_MS = 25.0;      // これ未満なら「速い」と判断
    static PERFORMANCE_CHECK_INTERVAL_MS = 3000;  // 3秒ごとにチェック

    // メモリ管理
    static MAX_CACHED_FRAMES = 10;         // LRUキャッシュの最大フレーム数
    static MEMORY_CLEANUP_INTERVAL = 100;  // 100フレームごとにクリーンアップ

    // カメラ設定
    static CAMERA_FAR_PLANE = 100;         // カメラの遠距離描画範囲
}

class MinimalSTMOVViewer {
    constructor() {
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.pointClouds = []; // 複数ユニット対応: 配列に変更

        // ジオメトリ・マテリアル・BufferAttribute再利用プール（GC負荷削減）
        this.geometryPool = [];         // 各ユニット用のジオメトリを保持
        this.materialPool = [];         // 各ユニット用のマテリアルを保持
        this.bufferAttributePool = [];  // 各ユニット用のBufferAttributeを保持（メモリリーク対策）
        this.colorAttributePool = [];   // 各ユニット用の色BufferAttributeを保持（深度カラー）

        // Playback state
        this.isPlaying = false;
        this.currentFrame = 0;
        this.units = []; // 複数ユニットのデータ格納
        this.frameRate = 30;
        this.lastFrameTime = 0;

        // STMOV data (複数ユニット対応)
        this.parser = new STMOVParser();

        // ST_Client定数: 1ユニット = 4m幅
        this.UNIT_WIDTH = 4.0;

        // 描画間隔設定（ST_Client inc パラメータ相当）
        this.drawIntervalMode = 'auto';     // 'auto' または 'manual'
        this.drawInterval = 1;              // 1=全点, 2=半分, 4=1/4, 8=1/8
        this.frameTimeHistory = [];         // 描画時間履歴（平滑化用）
        this.lastPerformanceCheck = 0;      // 最終調整時刻

        // パフォーマンス閾値（30fps = 33.3ms/frame）
        this.TARGET_FRAME_TIME = PerformanceConfig.TARGET_FRAME_TIME_MS;
        this.SLOW_THRESHOLD = PerformanceConfig.SLOW_THRESHOLD_MS;
        this.FAST_THRESHOLD = PerformanceConfig.FAST_THRESHOLD_MS;
        this.PERFORMANCE_CHECK_INTERVAL = PerformanceConfig.PERFORMANCE_CHECK_INTERVAL_MS;

        // LRUフレームキャッシュ（メモリ最適化 - Error Code 5対策）
        this.frameCache = new Map();        // キャッシュ: key="unit0_frame100", value=frameData
        this.frameCacheOrder = [];          // キャッシュ挿入順序（LRU管理用）
        this.MAX_CACHED_FRAMES = PerformanceConfig.MAX_CACHED_FRAMES;

        // 実測FPS計測用
        this.fpsHistory = [];               // 直近のフレーム時間を記録
        this.lastFpsUpdateTime = 0;         // FPS表示更新タイミング

        // カメラプリセット
        this.currentCameraPreset = 'free';  // デフォルトは自由視点
        this.cameraPresets = this.initCameraPresets();

        // フレームステップボタン押しっぱなし用
        this.frameStepInterval = null;
        this.frameStepTimeout = null;

        // 時間表示フォーマット ('frame' または 'seconds')
        this.timeDisplayFormat = 'frame';

        // 背景色設定
        this.backgroundColor = 'black';
        this.backgroundColors = {
            black: 0x000000,
            gray: 0x808080,
            white: 0xffffff
        };

        // 読み込まれたファイル名（スクリーンショット用）
        this.loadedFileName = 'stmov';

        this.init();
        this.setupEventListeners();
    }

    init() {
        const container = document.getElementById('three-container');

        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);

        // Camera optimized for 6-unit (24m) track visualization
        this.camera = new THREE.PerspectiveCamera(
            60,
            container.clientWidth / container.clientHeight,
            0.1,
            PerformanceConfig.CAMERA_FAR_PLANE
        );
        // 6ユニット(24m)走路全体を見渡せる位置
        // 右手座標系: X(左右), Y(上下), Z(奥行き-OpenGL反転済み)
        this.camera.position.set(12, 8, 10); // 24m走路の中央上空から

        // カメラを24m走路の中心に向ける
        this.camera.lookAt(12, 1.2, -1.2); // X=12は6ユニットの中央

        // Renderer optimized for large point clouds
        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            powerPreference: "high-performance",
            preserveDrawingBuffer: false,
            precision: "mediump"
        });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Performance optimizations
        this.renderer.sortObjects = false;
        this.renderer.shadowMap.enabled = false;

        container.appendChild(this.renderer.domElement);

        // Controls optimized for 24m track visualization
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.target.set(12, 1.2, -1.2); // 24m走路の中心を注視
        this.controls.minDistance = 5;
        this.controls.maxDistance = 50;
        this.controls.maxPolarAngle = Math.PI * 0.8; // Prevent camera from going too low

        // Basic lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(1, 1, 1);
        this.scene.add(directionalLight);

        // Add coordinate reference for 2m x 4m x 2.4m space
        this.addCoordinateReference();

        // Start render loop
        this.animate();

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize(), false);
    }

    setupEventListeners() {
        // File input
        const fileInput = document.getElementById('file-input');
        fileInput.addEventListener('change', (event) => {
            this.handleFileSelect(event);
        });

        // ファイル選択ボタン
        document.getElementById('file-select-button').addEventListener('click', () => {
            fileInput.click();
        });

        // ドロップゾーンのクリックでもファイル選択
        const dropZone = document.getElementById('drop-zone');
        dropZone.addEventListener('click', (event) => {
            // ボタン自体のクリックは除外（二重発火防止）
            if (event.target.id !== 'file-select-button') {
                fileInput.click();
            }
        });

        // ドラッグ&ドロップイベント
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        // ドラッグオーバー時の視覚的フィードバック
        dropZone.addEventListener('dragenter', () => {
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', (e) => {
            // 子要素への移動は無視
            if (e.target === dropZone) {
                dropZone.classList.remove('drag-over');
            }
        });

        dropZone.addEventListener('dragover', () => {
            dropZone.classList.add('drag-over');
        });

        // ドロップ時の処理
        dropZone.addEventListener('drop', (e) => {
            dropZone.classList.remove('drag-over');
            const files = Array.from(e.dataTransfer.files);
            this.handleFileDrop(files);
        });

        // Play/pause button
        document.getElementById('play-pause').addEventListener('click', () => {
            this.togglePlayback();
        });

        // Timeline slider
        document.getElementById('timeline').addEventListener('input', (event) => {
            this.seekToFrame(parseInt(event.target.value));
        });

        // Frame step buttons (押しっぱなしで連続送り対応)
        this.setupFrameStepButton('prev-frame', -1);
        this.setupFrameStepButton('next-frame', 1);

        // Keyboard controls
        document.addEventListener('keydown', (event) => {
            if (event.code === 'Space') {
                event.preventDefault();
                this.togglePlayback();
            } else if (event.code === 'ArrowLeft') {
                event.preventDefault();
                this.stepFrame(-1);
            } else if (event.code === 'ArrowRight') {
                event.preventDefault();
                this.stepFrame(1);
            }
        });

        // Parse quality selector (メモリ最適化)
        document.getElementById('parse-quality').addEventListener('change', (event) => {
            const quality = parseInt(event.target.value);
            this.parser.parseSubsample = quality;
            Logger.info(`解析品質を×${quality}に変更しました。ファイルを再読み込みしてください。`);
        });

        // Performance mode selector
        document.getElementById('draw-interval-mode').addEventListener('change', (event) => {
            this.drawIntervalMode = event.target.value;
            const slider = document.getElementById('draw-interval-slider');
            const display = document.getElementById('draw-interval-display');

            if (this.drawIntervalMode === 'manual') {
                slider.disabled = false;
                // Set slider to current interval
                slider.value = Math.log2(this.drawInterval);
            } else {
                slider.disabled = true;
                // Reset to auto mode
                this.frameTimeHistory = [];
                this.lastPerformanceCheck = 0;
            }

            Logger.debug(`描画モード: ${this.drawIntervalMode}`);
        });

        // Draw interval slider (manual mode)
        document.getElementById('draw-interval-slider').addEventListener('input', (event) => {
            const value = parseInt(event.target.value);
            this.drawInterval = Math.pow(2, value);  // 0→1, 1→2, 2→4, 3→8
            document.getElementById('draw-interval-display').textContent = `×${this.drawInterval}`;
            Logger.info(`描画間隔を×${this.drawInterval}に設定しました`);
        });

        // Camera preset selector
        document.getElementById('camera-preset').addEventListener('change', (event) => {
            this.setCameraPreset(event.target.value);
        });

        // Time format toggle button
        document.getElementById('time-format-toggle').addEventListener('click', () => {
            this.toggleTimeFormat();
        });

        // Background color selector
        document.getElementById('bg-color').addEventListener('change', (event) => {
            this.setBackgroundColor(event.target.value);
        });

        // Screenshot button
        document.getElementById('screenshot-btn').addEventListener('click', () => {
            this.captureScreenshot();
        });

        // Help panel toggle
        document.getElementById('help-button').addEventListener('click', () => {
            document.getElementById('help-panel').classList.add('open');
        });

        document.getElementById('close-help').addEventListener('click', () => {
            document.getElementById('help-panel').classList.remove('open');
        });

        // ヘルプパネル外をクリックで閉じる
        document.getElementById('help-panel').addEventListener('click', (event) => {
            if (event.target.id === 'help-panel') {
                document.getElementById('help-panel').classList.remove('open');
            }
        });
    }

    // フレームステップボタンの押しっぱなし対応セットアップ
    setupFrameStepButton(buttonId, direction) {
        const button = document.getElementById(buttonId);

        // mousedown: 最初の1回 + 連続送り開始
        button.addEventListener('mousedown', () => {
            if (!this.units || this.units.length === 0) return;

            // 最初の1フレーム送り
            this.stepFrame(direction);

            // 300ms後から連続送り開始（最初の遅延）
            this.frameStepTimeout = setTimeout(() => {
                this.frameStepInterval = setInterval(() => {
                    this.stepFrame(direction);
                }, 50); // 50msごと（20fps相当）
            }, 300);
        });

        // mouseup/mouseleave: 連続送り停止
        const stopFrameStep = () => {
            if (this.frameStepTimeout) {
                clearTimeout(this.frameStepTimeout);
                this.frameStepTimeout = null;
            }
            if (this.frameStepInterval) {
                clearInterval(this.frameStepInterval);
                this.frameStepInterval = null;
            }
        };

        button.addEventListener('mouseup', stopFrameStep);
        button.addEventListener('mouseleave', stopFrameStep);
    }

    // ファイル名から共通プレフィックスを抽出（スクリーンショット用）
    extractCommonPrefix(fileNames) {
        if (fileNames.length === 1) {
            // 単一ファイル: 拡張子を除去してそのまま返す
            return fileNames[0].replace(/\.(stmov|zip)$/i, '');
        }

        // 複数ファイル: 連番パターンを検出して共通部分を抽出
        // パターン: 末尾の "-1", "-2", "_1", "_2" など
        const pattern = /[-_]\d+$/;

        // 最初のファイルから拡張子と連番を除去
        const baseName = fileNames[0].replace(/\.(stmov|zip)$/i, '').replace(pattern, '');

        // すべてのファイルが同じベース名を持つか確認
        const allMatch = fileNames.every(name => {
            const normalized = name.replace(/\.(stmov|zip)$/i, '').replace(pattern, '');
            return normalized === baseName;
        });

        if (allMatch && baseName) {
            Logger.debug(`共通プレフィックス検出: "${baseName}" (${fileNames.length}ファイル)`);
            return baseName;  // 例: "00000XLIKI"
        }

        // パターンマッチしない場合はデフォルト
        Logger.debug('共通プレフィックス検出失敗、デフォルト名を使用');
        return 'stmov_multi';
    }

    // ドロップされたファイルを処理
    handleFileDrop(files) {
        // STMOVファイルのみフィルタリング
        const stmovFiles = files.filter(file =>
            file.name.endsWith('.stmov') || file.name.endsWith('.zip')
        );

        if (stmovFiles.length === 0) {
            this.showError('STMOVファイル（.stmovまたは.zip）をドロップしてください');
            return;
        }

        // ファイル名を保存（スクリーンショット用）
        const fileNames = stmovFiles.map(f => f.name);
        this.loadedFileName = this.extractCommonPrefix(fileNames);

        // FileListの代わりに配列を渡すため、専用処理
        this.loadFiles(stmovFiles);
    }

    async handleFileSelect(event) {
        const files = Array.from(event.target.files);
        if (files.length === 0) return;

        // ファイル名を保存（スクリーンショット用）
        const fileNames = files.map(f => f.name);
        this.loadedFileName = this.extractCommonPrefix(fileNames);

        this.loadFiles(files);
    }

    async loadFiles(files) {
        // 最大6ユニットまで
        if (files.length > 6) {
            this.showError('最大6ファイルまで読み込み可能です');
            return;
        }

        this.showLoading(true);
        this.units = []; // リセット

        try {
            Logger.debug(`Loading ${files.length} STMOV file(s)...`);

            // 全ファイルを並列で読み込み
            const loadPromises = files.map(async (file, index) => {
                Logger.debug(`Loading file ${index + 1}: ${file.name} (${file.size} bytes)`);
                const result = await this.parser.parseFile(file);

                // ZIP Track形式の場合は配列が返る、個別Unit形式は単一オブジェクト
                if (Array.isArray(result)) {
                    // ZIP Track形式: 複数ユニットの配列
                    Logger.debug(`  → ZIP Track format: ${result.length} units found`);
                    return result;
                } else {
                    // 個別Unit形式: 単一ユニットとして配列化
                    Logger.debug(`  → Individual Unit format`);
                    return [{
                        unitIndex: index,
                        fileName: file.name,
                        stmovData: result
                    }];
                }
            });

            // Promise.allの結果をフラット化（ZIP形式対応）
            const unitArrays = await Promise.all(loadPromises);
            this.units = unitArrays.flat();

            // ユニット数チェック
            if (this.units.length > 6) {
                this.showError('合計ユニット数が6を超えています');
                return;
            }

            // 各ユニットのフレームを処理
            for (const unit of this.units) {
                this.processUnitFrames(unit);
            }

            // Update UI
            this.updateFileInfo();
            this.enableControls();

            // Show first frame
            this.displayFrame(0);

            Logger.info(`${this.units.length} STMOV unit(s) loaded successfully`);

        } catch (error) {
            Logger.error('Failed to load STMOV files:', error);
            this.showError(`ファイルの読み込みに失敗しました: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    processUnitFrames(unit) {
        // メモリ最適化: unit.framesを作らず、unit.stmovData.framesを直接使用
        // これにより、全フレームのrawDataコピーを避け、メモリ使用量を大幅削減
        Logger.debug(`Processing Unit ${unit.unitIndex + 1}: ${unit.stmovData.frameCount} frames ready for on-demand loading`);

        // フレーム数だけ保存（互換性維持）
        unit.frameCount = unit.stmovData.frameCount;
    }

    displayFrame(frameIndex) {
        if (!this.units || this.units.length === 0) return;

        const frameStartTime = performance.now();

        // 既存の全ての点群をシーンから削除（ジオメトリは再利用するのでdisposeしない）
        for (const pointCloud of this.pointClouds) {
            if (pointCloud) {
                this.scene.remove(pointCloud);
                // dispose()呼び出しを削除: ジオメトリとマテリアルは再利用プールで管理
            }
        }
        this.pointClouds = [];

        // 各ユニットの点群を表示
        for (const unit of this.units) {
            // フレーム範囲チェック（stmovDataから直接取得）
            if (!unit.stmovData || frameIndex >= unit.stmovData.frameCount) continue;

            const unitIndex = unit.unitIndex;

            // LRUキャッシュからフレームデータを取得
            let frame = this.getFrameFromCache(unitIndex, frameIndex);

            // キャッシュにない場合は、元データから展開
            if (!frame) {
                // stmovData.framesから直接読み込む（メモリ効率的）
                const rawFrameData = unit.stmovData.frames[frameIndex];

                if (!rawFrameData || !rawFrameData.data) {
                    Logger.warn(`Unit ${unitIndex + 1}, Frame ${frameIndex}: No raw data`);
                    continue;
                }

                // Decompress frame on demand
                const points = this.parser.decompressFrame(
                    rawFrameData.data,
                    unit.stmovData.leftCamera,
                    unit.stmovData.rightCamera
                );

                // フレームオブジェクトを作成
                frame = {
                    index: frameIndex,
                    points: points,
                    pointCount: points.length / 3
                };

                // フレームデータをキャッシュに追加（古いフレームは自動削除される）
                this.addFrameToCache(unitIndex, frameIndex, frame);
            }

            if (frame.points.length === 0) {
                Logger.warn(`Unit ${unit.unitIndex + 1}, Frame ${frameIndex} has no points`);
                continue;
            }

            // ST_Client準拠: 各ユニットを4m間隔で配置
            // 点群座標系: X[-2, +2] → ワールド座標系: X[0, 4], X[4, 8], ...
            // オフセット = ユニットインデックス × 4m + 2m（ユニット中心）
            const offsetX = unit.unitIndex * this.UNIT_WIDTH + 2.0;
            this.displayUnitFrame(frame, offsetX, unit);
        }

        const frameEndTime = performance.now();
        const frameDrawTime = frameEndTime - frameStartTime;

        // 自動モード時のパフォーマンス監視
        if (this.drawIntervalMode === 'auto') {
            this.updateDrawInterval(frameDrawTime);
        }

        // 定期的なメモリクリーンアップ
        // JavaScriptのGCを促進してメモリ断片化を防ぐ
        if (frameIndex % PerformanceConfig.MEMORY_CLEANUP_INTERVAL === 0 && frameIndex > 0) {
            // ブラウザは自動的にメモリ管理を行うため、明示的なGC呼び出しは不要
            Logger.debug(`[Memory] Frame ${frameIndex}: Periodic cleanup triggered`);
        }

        // Update current frame
        this.currentFrame = frameIndex;
        this.updateTimeDisplay();
    }

    displayUnitFrame(frame, offsetX, unit) {
        // ST_Client準拠のOpenGL座標変換 + ユニットオフセット + 範囲フィルタ
        // ST_Client: glVertex3f(x + add_x, y + add_y, -(z + add_z))

        const unitIndex = unit.unitIndex;

        // 各ユニットの緑枠範囲（ワールド座標系）
        // Unit i: X[i*4, (i+1)*4], Y[0, 2.4], Z[0, 2.3] (OpenGL反転前)
        const unitMinX = unitIndex * this.UNIT_WIDTH;
        const unitMaxX = (unitIndex + 1) * this.UNIT_WIDTH;
        const unitMinY = 0.0;
        const unitMaxY = 2.4;
        const unitMinZ = 0.0;  // OpenGL反転前の範囲
        const unitMaxZ = 2.3;  // ST_Client準拠: 壁際10cm除外（GROUND_XFAR = 2.30f）

        // 範囲内の点のみをフィルタリング
        // ST_Client準拠: 描画間隔（inc）を適用してパフォーマンス最適化
        const filteredPoints = [];
        const filteredColors = [];  // 深度カラーマッピング用
        const GROUND_DEPTH = 2.4;   // ST_Client準拠

        for (let i = 0; i < frame.points.length; i += 3 * this.drawInterval) {
            const worldX = frame.points[i] + offsetX;     // ワールドX座標
            const worldY = frame.points[i + 1];           // ワールドY座標
            const worldZ = frame.points[i + 2];           // ワールドZ座標（OpenGL反転前）

            // 範囲チェック（緑枠内のみ）
            if (worldX >= unitMinX && worldX <= unitMaxX &&
                worldY >= unitMinY && worldY <= unitMaxY &&
                worldZ >= unitMinZ && worldZ <= unitMaxZ) {
                filteredPoints.push(worldX);              // X（そのまま）
                filteredPoints.push(worldY);              // Y（そのまま）
                filteredPoints.push(-worldZ);             // Z（OpenGL反転）

                // ST_Client準拠の深度カラーマッピング
                // St3dData.cpp:212 - col = (GROUND_DEPTH - z) / GROUND_DEPTH
                const depth = worldZ;  // 0.0 ～ 2.3
                let col = (GROUND_DEPTH - depth) / GROUND_DEPTH;
                col = Math.max(0.25, Math.min(0.9, col));  // 0.25 ～ 0.9にクランプ

                // 背景色に応じた色調整
                let r, g, b;
                if (this.backgroundColor === 'white') {
                    // 白背景: 濃い茶色系（コントラスト確保）
                    const invCol = 1.0 - col;  // 反転（手前=濃い、奥=薄い）
                    r = invCol * 0.5 + 0.2;    // 0.2 ～ 0.7
                    g = invCol * 0.4 + 0.15;   // 0.15 ～ 0.55
                    b = invCol * 0.3 + 0.1;    // 0.1 ～ 0.4
                } else if (this.backgroundColor === 'gray') {
                    // グレー背景: やや濃いめのベージュ
                    r = col * 0.9;
                    g = col * 0.8;
                    b = col * 0.7;
                } else {
                    // 黒背景（デフォルト）: 明るいベージュ系
                    r = col;
                    g = col * 0.9;
                    b = col * 0.8;
                }

                filteredColors.push(r);
                filteredColors.push(g);
                filteredColors.push(b);
            }
        }

        const glPoints = new Float32Array(filteredPoints);
        const glColors = new Float32Array(filteredColors);

        // ジオメトリの再利用（GC負荷削減）
        // 初回のみ作成、2回目以降は既存のジオメトリを再利用
        if (!this.geometryPool[unitIndex]) {
            this.geometryPool[unitIndex] = new THREE.BufferGeometry();
            Logger.debug(`[Geometry Pool] Created geometry for Unit ${unitIndex + 1}`);
        }
        const geometry = this.geometryPool[unitIndex];

        // BufferAttributeの再利用（メモリリーク対策 - 最重要）
        // 毎フレーム新しいBufferAttributeを作成するとメモリリークが発生するため、
        // 既存のBufferAttributeを再利用してデータのみ更新する
        const pointCount = glPoints.length / 3;
        if (!this.bufferAttributePool[unitIndex] ||
            this.bufferAttributePool[unitIndex].count !== pointCount) {
            // 初回 or 点群数が変わった場合のみ新規作成
            this.bufferAttributePool[unitIndex] = new THREE.Float32BufferAttribute(glPoints, 3);
            Logger.debug(`[BufferAttribute Pool] Created new buffer for Unit ${unitIndex + 1} (${pointCount} points)`);
        } else {
            // 既存のBufferAttributeのデータを上書き（メモリ効率的）
            this.bufferAttributePool[unitIndex].array.set(glPoints);
            this.bufferAttributePool[unitIndex].needsUpdate = true;  // GPU側に更新を通知
        }
        geometry.setAttribute('position', this.bufferAttributePool[unitIndex]);

        // 色BufferAttributeの再利用（深度カラーマッピング）
        if (!this.colorAttributePool[unitIndex] ||
            this.colorAttributePool[unitIndex].count !== pointCount) {
            // 初回 or 点群数が変わった場合のみ新規作成
            this.colorAttributePool[unitIndex] = new THREE.Float32BufferAttribute(glColors, 3);
            Logger.debug(`[Color Pool] Created color buffer for Unit ${unitIndex + 1}`);
        } else {
            // 既存のBufferAttributeのデータを上書き
            this.colorAttributePool[unitIndex].array.set(glColors);
            this.colorAttributePool[unitIndex].needsUpdate = true;
        }
        geometry.setAttribute('color', this.colorAttributePool[unitIndex]);

        // マテリアルの再利用（GC負荷削減）
        // 初回のみ作成、2回目以降は既存のマテリアルを再利用
        const dotSize = unit.stmovData?.dotSize || 3.0;  // デフォルト3.0
        if (!this.materialPool[unitIndex]) {
            this.materialPool[unitIndex] = new THREE.PointsMaterial({
                size: dotSize / 100.0,  // STMOVファイルから取得（単位調整: 3.0 → 0.03）
                sizeAttenuation: true,
                transparent: false,
                opacity: 1.0,
                vertexColors: true,     // 深度カラーマッピング有効
                // Performance optimizations for large point clouds
                alphaTest: 0.1,
                depthWrite: true,
                depthTest: true
            });
            Logger.debug(`[Material Pool] Created material for Unit ${unitIndex + 1}`);
        }
        const material = this.materialPool[unitIndex];

        // 点群オブジェクト作成（ジオメトリとマテリアルは再利用）
        const pointCloud = new THREE.Points(geometry, material);

        // 🔧 大量点群対応: フラスタムカリングを無効化
        pointCloud.frustumCulled = false; // 視界外の点群も描画

        this.scene.add(pointCloud);
        this.pointClouds.push(pointCloud);

        // デバッグ情報: 点群の座標範囲とフィルタ結果を確認
        const originalPointCount = frame.points.length / 3;
        const filteredPointCount = filteredPoints.length / 3;
        const filterRatio = ((filteredPointCount / originalPointCount) * 100).toFixed(1);

        Logger.debug(`Unit ${unitIndex + 1}, Frame ${this.currentFrame}: Original=${originalPointCount}, Filtered=${filteredPointCount} (${filterRatio}%), OffsetX=${offsetX.toFixed(2)}m`);
        Logger.debug(`  Unit range: X[${unitMinX.toFixed(1)}, ${unitMaxX.toFixed(1)}], Y[${unitMinY.toFixed(1)}, ${unitMaxY.toFixed(1)}], Z[${unitMinZ.toFixed(1)}, ${unitMaxZ.toFixed(1)}]`);
    }

    updateDrawInterval(frameDrawTime) {
        // 履歴に追加（直近10フレーム）
        this.frameTimeHistory.push(frameDrawTime);
        if (this.frameTimeHistory.length > 10) {
            this.frameTimeHistory.shift();
        }

        // 平均描画時間を計算
        const avgFrameTime = this.frameTimeHistory.reduce((a, b) => a + b, 0) / this.frameTimeHistory.length;

        // 5秒ごとに調整判定（頻繁な調整を防ぐ）
        const now = performance.now();
        if (now - this.lastPerformanceCheck < this.PERFORMANCE_CHECK_INTERVAL) {
            return;
        }
        this.lastPerformanceCheck = now;

        // 描画が遅い → 間引きを増やす
        if (avgFrameTime > this.SLOW_THRESHOLD && this.drawInterval < 8) {
            const oldInterval = this.drawInterval;
            this.drawInterval *= 2;
            Logger.info(`[Performance] Avg draw time ${avgFrameTime.toFixed(1)}ms > ${this.SLOW_THRESHOLD}ms, interval ${oldInterval}x → ${this.drawInterval}x`);
        }
        // 描画が速い → 間引きを戻す
        else if (avgFrameTime < this.FAST_THRESHOLD && this.drawInterval > 1) {
            const oldInterval = this.drawInterval;
            this.drawInterval = Math.max(1, this.drawInterval / 2);
            Logger.info(`[Performance] Avg draw time ${avgFrameTime.toFixed(1)}ms < ${this.FAST_THRESHOLD}ms, interval ${oldInterval}x → ${this.drawInterval}x`);
        }
    }

    /**
     * LRUフレームキャッシュ: フレームデータを追加
     * 古いフレームを自動削除してメモリを一定に保つ
     */
    addFrameToCache(unitIndex, frameIndex, frameData) {
        // キャッシュキーを生成（例: "unit0_frame100"）
        const cacheKey = `unit${unitIndex}_frame${frameIndex}`;

        // すでにキャッシュに存在する場合は何もしない
        if (this.frameCache.has(cacheKey)) {
            return;
        }

        // キャッシュに追加
        this.frameCache.set(cacheKey, frameData);
        this.frameCacheOrder.push(cacheKey);

        // キャッシュサイズをチェック
        if (this.frameCacheOrder.length > this.MAX_CACHED_FRAMES) {
            // 最古のフレームを削除（LRU方式）
            const oldestKey = this.frameCacheOrder.shift();
            this.frameCache.delete(oldestKey);

            // デバッグログ（初回のみ表示）
            if (this.frameCacheOrder.length === this.MAX_CACHED_FRAMES) {
                Logger.info(`[Frame Cache] LRU cache initialized: keeping ${this.MAX_CACHED_FRAMES} frames in memory`);
            }
        }
    }

    /**
     * LRUフレームキャッシュ: フレームデータを取得
     */
    getFrameFromCache(unitIndex, frameIndex) {
        const cacheKey = `unit${unitIndex}_frame${frameIndex}`;
        return this.frameCache.get(cacheKey);
    }

    togglePlayback() {
        if (!this.units || this.units.length === 0) return;

        // 停止中かつ最後のフレームにいる場合は、最初から再生
        if (!this.isPlaying && this.isAtLastFrame()) {
            this.currentFrame = 0;
            this.displayFrame(0);
        }

        this.isPlaying = !this.isPlaying;
        this.updatePlayButton();

        if (this.isPlaying) {
            this.lastFrameTime = performance.now();
        }
    }

    // 最後のフレームにいるかどうかを判定
    isAtLastFrame() {
        const maxFrames = this.getMaxFrames();
        return this.currentFrame >= maxFrames - 1;
    }

    // 最大フレーム数を取得（全ユニットの最小値）
    getMaxFrames() {
        if (!this.units || this.units.length === 0) return 0;
        return Math.min(...this.units.map(u => u.frameCount || 0));
    }

    // 再生を停止する
    stopPlayback() {
        this.isPlaying = false;
        this.updatePlayButton();
        this.updateTimeDisplay();
    }

    seekToFrame(frameIndex) {
        if (!this.units || this.units.length === 0) return;

        // フレーム範囲内にクランプ
        const maxFrames = this.getMaxFrames();
        frameIndex = Math.max(0, Math.min(frameIndex, maxFrames - 1));
        this.displayFrame(frameIndex);
    }

    // 1フレーム進む/戻る
    stepFrame(direction) {
        if (!this.units || this.units.length === 0) return;

        const maxFrames = this.getMaxFrames();
        const newFrame = this.currentFrame + direction;

        // フレーム範囲内にクランプ
        if (newFrame >= 0 && newFrame < maxFrames) {
            this.currentFrame = newFrame;
            this.displayFrame(this.currentFrame);
        }
    }

    updatePlayback() {
        if (!this.isPlaying || !this.units || this.units.length === 0) return;

        const now = performance.now();
        const deltaTime = now - this.lastFrameTime;
        const frameInterval = 1000 / this.frameRate;

        if (deltaTime >= frameInterval) {
            this.currentFrame++;

            // 最後のフレームを超えたら停止
            const maxFrames = this.getMaxFrames();
            if (this.currentFrame >= maxFrames) {
                this.currentFrame = maxFrames - 1;
                this.displayFrame(this.currentFrame);
                this.stopPlayback();
                return;
            }

            // フレーム描画時間を計測（実測FPS計算用）
            const frameStartTime = performance.now();
            this.displayFrame(this.currentFrame);
            const frameEndTime = performance.now();
            const actualFrameTime = frameEndTime - frameStartTime;

            // フレーム時間履歴に追加（直近10フレーム）
            this.fpsHistory.push(actualFrameTime);
            if (this.fpsHistory.length > 10) {
                this.fpsHistory.shift();
            }

            // 0.5秒ごとにFPS表示を更新
            if (now - this.lastFpsUpdateTime > 500) {
                this.updateFpsDisplay();
                this.lastFpsUpdateTime = now;
            }

            // 描画時間を考慮した正確なフレームタイミング
            // 描画処理が遅延しても、目標フレームレートを維持するように補正
            this.lastFrameTime += frameInterval; // nowではなくframeIntervalを加算
        }
    }

    /**
     * HTMLエスケープ関数（XSS対策）
     * @param {string} text - エスケープする文字列
     * @returns {string} - エスケープ済み文字列
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;  // textContentは自動的にエスケープ
        return div.innerHTML;
    }

    updateFileInfo() {
        const info = document.getElementById('file-info');
        if (this.units && this.units.length > 0) {
            let infoHTML = `<strong>マルチユニット STMOV (${this.units.length} ユニット)</strong><br>`;

            for (const unit of this.units) {
                const safeFileName = this.escapeHtml(unit.fileName);  // XSS対策
                infoHTML += `<strong>ユニット ${unit.unitIndex + 1}</strong>: ${safeFileName}<br>`;
                infoHTML += `フレーム数: ${unit.stmovData.frameCount}, `;
                infoHTML += `時間: ${(unit.stmovData.totalTime / 1000).toFixed(1)}秒<br>`;
            }

            const totalDistance = this.units.length * this.UNIT_WIDTH;
            infoHTML += `<br><strong>走路: ${totalDistance}m (${this.units.length} × 4m)</strong>`;

            info.innerHTML = infoHTML;
            document.getElementById('info').style.display = 'block';
        }
    }

    getTimeText() {
        if (this.timeDisplayFormat === 'seconds') {
            return (this.currentFrame / this.frameRate).toFixed(2) + 's';
        } else {
            return this.currentFrame.toString();
        }
    }

    getTotalTimeText() {
        const maxFrames = this.getMaxFrames();

        if (this.timeDisplayFormat === 'seconds') {
            return maxFrames > 0 ? ((maxFrames - 1) / this.frameRate).toFixed(2) + 's' : '0.00s';
        } else {
            return maxFrames > 0 ? (maxFrames - 1).toString() : '0';
        }
    }

    updateTimeDisplay() {
        const maxFrames = this.getMaxFrames();

        // 現在時刻の更新（変更時のみ）
        const currentTimeText = this.getTimeText();
        const currentTimeEl = document.getElementById('current-time');
        if (currentTimeEl.textContent !== currentTimeText) {
            currentTimeEl.textContent = currentTimeText;
        }

        // 合計時間の更新（変更時のみ）
        const totalTimeText = this.getTotalTimeText();
        const totalTimeEl = document.getElementById('total-time');
        if (totalTimeEl.textContent !== totalTimeText) {
            totalTimeEl.textContent = totalTimeText;
        }

        // タイムラインスライダーの更新（変更時のみ）
        const timeline = document.getElementById('timeline');
        if (maxFrames > 0) {
            const maxValue = (maxFrames - 1).toString();
            if (timeline.max !== maxValue) {
                timeline.max = maxValue;
            }

            const currentValue = this.currentFrame.toString();
            if (timeline.value !== currentValue) {
                timeline.value = currentValue;
            }
        }
    }

    toggleTimeFormat() {
        // フォーマット切り替え
        this.timeDisplayFormat = this.timeDisplayFormat === 'frame' ? 'seconds' : 'frame';

        // ボタンラベル更新
        const button = document.getElementById('time-format-toggle');
        button.textContent = this.timeDisplayFormat === 'frame' ? 'フレーム' : '秒数';

        // 時間表示更新
        this.updateTimeDisplay();
    }

    setBackgroundColor(color) {
        // 背景色を変更
        this.backgroundColor = color;
        this.scene.background = new THREE.Color(this.backgroundColors[color]);

        // 現在のフレームを再描画（点の色を更新）
        if (this.units && this.units.length > 0) {
            this.displayFrame(this.currentFrame);
        }

        Logger.info(`背景色を「${color}」に変更しました`);
    }

    captureScreenshot() {
        // スクリーンショット用に明示的にレンダリング
        // preserveDrawingBuffer: false でも正しく画像を取得できる
        this.controls.update();
        this.renderer.render(this.scene, this.camera);

        // Three.jsレンダラーからPNG画像を取得
        const dataURL = this.renderer.domElement.toDataURL('image/png');

        // ダウンロードリンクを生成
        const link = document.createElement('a');
        const fileName = `${this.loadedFileName}_frame_${this.currentFrame}.png`;
        link.download = fileName;
        link.href = dataURL;

        // ダウンロード実行
        link.click();

        Logger.info(`スクリーンショットを保存: ${fileName}`);
    }

    updatePlayButton() {
        const button = document.getElementById('play-pause');
        button.textContent = this.isPlaying ? '❚❚ 一時停止' : '▶ 再生';
    }

    updateFpsDisplay() {
        if (this.fpsHistory.length === 0) return;

        // 直近10フレームの平均時間を計算
        const avgFrameTime = this.fpsHistory.reduce((a, b) => a + b, 0) / this.fpsHistory.length;

        // 実測FPSを計算（1000ms ÷ 平均フレーム時間）
        const actualFps = 1000 / avgFrameTime;

        // FPS表示を更新（色分け: 緑=30fps, 黄=25-30fps, 赤=25fps未満）
        const fpsDisplay = document.getElementById('fps-display');
        const fpsNote = document.getElementById('fps-note');

        if (actualFps >= 30) {
            // 30fps以上: 正常
            fpsDisplay.style.color = '#0f0'; // 緑
            fpsDisplay.textContent = `FPS: ${actualFps.toFixed(1)}`;
            fpsNote.style.color = '#888';
            fpsNote.innerHTML = '（再生は30fps固定）';
        } else if (actualFps >= 25) {
            // 25-30fps: 警告（黄色）
            fpsDisplay.style.color = '#ff0'; // 黄
            fpsDisplay.textContent = `FPS: ${actualFps.toFixed(1)} ⚠️`;
            fpsNote.style.color = '#ff0';
            fpsNote.innerHTML = `⚠️ 処理が重く、${actualFps.toFixed(1)}fpsで再生中<br>（解析品質を下げてください）`;
        } else {
            // 25fps未満: 重度の警告（赤色）
            fpsDisplay.style.color = '#f00'; // 赤
            fpsDisplay.textContent = `FPS: ${actualFps.toFixed(1)} ⚠️`;
            fpsNote.style.color = '#f00';
            fpsNote.innerHTML = `⚠️ 処理が重く、${actualFps.toFixed(1)}fpsで再生中<br>（解析品質を下げてください）`;
        }
    }

    enableControls() {
        document.getElementById('play-pause').disabled = false;
        document.getElementById('timeline').disabled = false;
        document.getElementById('prev-frame').disabled = false;
        document.getElementById('next-frame').disabled = false;
        document.getElementById('screenshot-btn').disabled = false;
    }

    showLoading(show) {
        document.getElementById('loading').style.display = show ? 'block' : 'none';
    }

    showError(message) {
        // エラーコンテナを取得（なければ作成）
        let errorContainer = document.getElementById('error-container');
        if (!errorContainer) {
            errorContainer = document.createElement('div');
            errorContainer.id = 'error-container';
            errorContainer.className = 'error-container';
            document.body.appendChild(errorContainer);
        }

        // エラーメッセージ要素を作成
        const errorItem = document.createElement('div');
        errorItem.className = 'error-item';

        // メッセージ部分を安全に作成（XSS対策）
        const messageSpan = document.createElement('span');
        messageSpan.textContent = `⚠️ エラー: ${message}`;  // textContentは自動的にエスケープ

        // 閉じるボタンを安全に作成
        const closeButton = document.createElement('button');
        closeButton.className = 'error-close';
        closeButton.textContent = '×';
        closeButton.onclick = () => errorItem.remove();  // インラインイベントハンドラではなくプロパティで設定

        // 組み立て
        errorItem.appendChild(messageSpan);
        errorItem.appendChild(closeButton);
        errorContainer.appendChild(errorItem);

        // 10秒後に自動削除
        setTimeout(() => {
            if (errorItem.parentElement) {
                errorItem.remove();
            }
        }, 10000);
    }

    onWindowResize() {
        const container = document.getElementById('three-container');
        this.camera.aspect = container.clientWidth / container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(container.clientWidth, container.clientHeight);
    }

    addCoordinateReference() {
        // 24m走路全体の床グリッド
        const gridHelper = new THREE.GridHelper(30, 30, 0x444444, 0x222222);
        gridHelper.position.set(12, 0, 0); // 24m走路の中央
        this.scene.add(gridHelper);

        // ST_Client座標軸: X=赤(左右), Y=緑(上下), Z=青(奥行き)
        const axesHelper = new THREE.AxesHelper(2);
        axesHelper.position.set(0, 0, 0);
        this.scene.add(axesHelper);

        // 各ユニットの参照ボックスを追加（最大6個）
        this.addMultiUnitCaptureBoxes();
    }

    addMultiUnitCaptureBoxes() {
        // 6ユニット分の参照ボックスを追加
        // ST_Client座標系: 各ユニット 4m × 2.4m × 2.4m
        const boxGeometry = new THREE.BoxGeometry(4, 2.4, 2.4);

        for (let i = 0; i < 6; i++) {
            // ワイヤーフレーム表示（白色で統一）
            const edges = new THREE.EdgesGeometry(boxGeometry);
            const lineMaterial = new THREE.LineBasicMaterial({
                color: 0xffffff,  // 白色
                linewidth: 1,
                transparent: true,
                opacity: 0.6
            });

            const captureBox = new THREE.LineSegments(edges, lineMaterial);

            // ST_Client準拠の配置:
            // Unit i の X座標範囲: i*4 ~ (i+1)*4 → 中心: i*4 + 2
            // Y: 床面から1.2m上 (0～2.4mの中心)
            // Z: -1.2 (Z軸反転適用、0～2.4mの中心)
            const offsetX = i * this.UNIT_WIDTH + 2; // ユニット中心のX座標
            captureBox.position.set(offsetX, 1.2, -1.2);
            this.scene.add(captureBox);
        }

        // 床面（Y=0）
        const groundGeometry = new THREE.PlaneGeometry(30, 10);
        const groundMaterial = new THREE.MeshBasicMaterial({
            color: 0x333333,
            transparent: true,
            opacity: 0.2,
            side: THREE.DoubleSide
        });
        const groundPlane = new THREE.Mesh(groundGeometry, groundMaterial);
        groundPlane.rotation.x = -Math.PI / 2; // 水平配置
        groundPlane.position.set(12, 0, 0); // 24m走路の中央
        this.scene.add(groundPlane);
    }

    initCameraPresets() {
        // ST_Client準拠の5視点プリセット（24m走路に最適化）
        return {
            free: {
                name: 'Free',
                position: null,  // OrbitControls有効（現在の位置を維持）
                lookAt: null,
                enableControls: true
            },
            front: {
                name: 'Front View',
                position: [12, 1.5, 15],     // 走路中央の正面15m離れた位置
                lookAt: [12, 1.2, -1.2],     // 走路中央、空間の中心
                enableControls: false
            },
            side: {
                name: 'Side View',
                position: [30, 1.5, -1.2],   // 走路の右側30m、Z=-1.2（空間の中心）
                lookAt: [12, 1.2, -1.2],     // 走路中央、空間の中心
                enableControls: false
            },
            top: {
                name: 'Top View',
                position: [12, 25, -1.2],    // 真上25m、空間の中心
                lookAt: [12, 0, -1.2],       // 走路中央の床面、空間の中心
                enableControls: false
            },
            diagonal: {
                name: 'Diagonal View',
                position: [25, 12, 12],      // 斜め上から
                lookAt: [12, 1.2, -1.2],     // 走路中央、空間の中心
                enableControls: false
            }
        };
    }

    setCameraPreset(presetName) {
        const preset = this.cameraPresets[presetName];
        if (!preset) {
            Logger.warn(`Unknown camera preset: ${presetName}`);
            return;
        }

        this.currentCameraPreset = presetName;
        Logger.info(`Camera preset: ${preset.name}`);

        if (presetName === 'free') {
            // 自由視点: OrbitControlsを有効化
            this.controls.enabled = true;
        } else {
            // 固定視点: OrbitControlsを無効化、カメラ位置を設定
            this.controls.enabled = false;

            // カメラ位置を設定
            this.camera.position.set(...preset.position);
            this.camera.lookAt(new THREE.Vector3(...preset.lookAt));

            // OrbitControlsのターゲットも更新（後で自由視点に戻した時のため）
            this.controls.target.set(...preset.lookAt);
            this.controls.update();
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        this.updatePlayback();

        // 自由視点の時のみOrbitControlsを更新
        if (this.currentCameraPreset === 'free') {
            this.controls.update();
        }

        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize the viewer when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new MinimalSTMOVViewer();
});