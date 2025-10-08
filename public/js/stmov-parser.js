/**
 * STMOV Parser - Minimal implementation based on platform-independent specification
 * Focuses on single unit file processing for basic 3D point cloud playback
 */

/**
 * STMOV解析の定数
 */
class STMOVConfig {
    static MAX_POINTS_PER_FRAME = 500000;  // 1フレームの最大点数（50万点）
}

class STMOVParser {
    constructor() {
        // パース時サブサンプリング設定（メモリ最適化）
        // 1=全点, 2=半分, 4=1/4, 8=1/8
        this.parseSubsample = 4;  // デフォルト: ×4（メモリ25%、品質と速度のバランス）

        this.reset();
    }

    reset() {
        this.signature = null;
        this.version = { major: 0, minor: 0 };
        this.frameCount = 0;
        this.totalTime = 0;
        this.compressionFormat = null;
        this.leftCamera = null;
        this.rightCamera = null;
        this.dotSize = 0;
        this.frames = [];
    }

    /**
     * Parse STMOV file (ZIP or single unit)
     * @param {File} file - Selected file
     * @returns {Promise<Object>} Parsed data
     */
    async parseFile(file) {
        this.reset();

        try {
            const arrayBuffer = await file.arrayBuffer();

            // Check if it's a ZIP file (Track format)
            if (this.isZipFile(arrayBuffer)) {
                return await this.parseTrackFile(arrayBuffer);
            } else {
                // Single unit file
                return await this.parseUnitFile(arrayBuffer);
            }
        } catch (error) {
            throw new Error(`STMOV parsing failed: ${error.message}`);
        }
    }

    /**
     * Check if file is ZIP format
     */
    isZipFile(buffer) {
        const view = new DataView(buffer);
        // ZIP files start with "PK" (0x504B)
        return view.getUint16(0, false) === 0x504B;
    }

    /**
     * Parse Track file (ZIP containing multiple units)
     * ST_Client/Unity準拠: 全ユニットを配列で返す
     */
    async parseTrackFile(buffer) {
        const JSZip = window.JSZip;
        if (!JSZip) {
            throw new Error('JSZip library not loaded');
        }

        const zip = await JSZip.loadAsync(buffer);

        // ZIP内の全.stmovファイルを検索
        const stmovFiles = [];
        for (const fileName in zip.files) {
            if (fileName.endsWith('.stmov') && !zip.files[fileName].dir) {
                stmovFiles.push(fileName);
            }
        }

        // ファイル名でソート（数字順）
        stmovFiles.sort((a, b) => {
            // ファイル名から数字を抽出（例: "00000HRMNN-1.stmov" → 1）
            const numA = parseInt(a.match(/-(\d+)\.stmov$/)?.[1] || '0');
            const numB = parseInt(b.match(/-(\d+)\.stmov$/)?.[1] || '0');
            return numA - numB;
        });

        Logger.debug(`Found ${stmovFiles.length} STMOV files in ZIP:`, stmovFiles);

        // ST_Client/Unity TrackReader準拠: 全ユニットを読み込み（最大6個）
        const units = [];
        for (let i = 0; i < Math.min(stmovFiles.length, 6); i++) {
            const fileName = stmovFiles[i];
            Logger.debug(`Loading unit ${i + 1}: ${fileName}...`);

            const unitBuffer = await zip.files[fileName].async('arraybuffer');
            const unitData = await this.parseUnitFile(unitBuffer);

            units.push({
                unitIndex: i,  // 0-based index
                fileName: fileName,
                stmovData: unitData
            });
        }

        if (units.length === 0) {
            throw new Error('No .stmov files found in ZIP');
        }

        Logger.info(`Loaded ${units.length} units from ZIP Track file`);
        return units;
    }

    /**
     * Parse single unit file according to specification
     */
    async parseUnitFile(buffer) {
        const view = new DataView(buffer);
        let offset = 0;

        // 1. File signature (6 bytes) - "STMOV\0" or "STMV  " (variations exist)
        this.signature = new TextDecoder().decode(new Uint8Array(buffer, offset, 6));
        offset += 6;

        // Accept both "STMOV" and "STMV" signatures
        if (!this.signature.startsWith('STMOV') && !this.signature.startsWith('STMV')) {
            throw new Error(`Invalid signature: ${this.signature}`);
        }

        // 2. Version (2 bytes)
        this.version.major = view.getUint8(offset++);
        this.version.minor = view.getUint8(offset++);

        // 3. Total frame count (4 bytes, little-endian)
        this.frameCount = view.getUint32(offset, true);
        offset += 4;

        // 4. Total time in milliseconds (4 bytes, little-endian)
        this.totalTime = view.getUint32(offset, true);
        offset += 4;

        // 5. Compression format (16 bytes ASCII)
        this.compressionFormat = new TextDecoder().decode(
            new Uint8Array(buffer, offset, 16)
        ).trim().replace(/\0/g, '');
        offset += 16;

        // 6. Left camera info (36 bytes = 9 floats)
        this.leftCamera = this.readCameraInfo(view, offset);
        offset += 36;

        // 7. Right camera info (36 bytes = 9 floats)
        this.rightCamera = this.readCameraInfo(view, offset);
        offset += 36;

        // 8. Dot size (4 bytes float)
        this.dotSize = view.getFloat32(offset, true);
        offset += 4;

        // 9. Frame data
        Logger.info(`Parsing ${this.frameCount} frames...`);
        this.frames = [];

        for (let i = 0; i < this.frameCount; i++) {
            if (offset >= buffer.byteLength - 6) break; // Check for EOF marker

            // Voxel count (4 bytes)
            const voxelCount = view.getUint32(offset, true);
            offset += 4;

            // Compressed data size (4 bytes)
            const dataSize = view.getUint32(offset, true);
            offset += 4;

            // Compressed data
            const frameData = new Uint8Array(buffer, offset, dataSize);
            offset += dataSize;

            this.frames.push({
                index: i,
                voxelCount,
                dataSize,
                data: frameData
            });

            // Memory optimization: limit points per frame instead of total frames
            // This allows full video playback while managing memory
        }

        Logger.info(`Parsed STMOV: ${this.frameCount} frames, format: ${this.compressionFormat}`);

        return {
            signature: this.signature,
            version: this.version,
            frameCount: this.frameCount,
            totalTime: this.totalTime,
            compressionFormat: this.compressionFormat,
            leftCamera: this.leftCamera,
            rightCamera: this.rightCamera,
            dotSize: this.dotSize,
            frames: this.frames
        };
    }

    /**
     * Read camera information (9 floats: position, rotation, scale)
     */
    readCameraInfo(view, offset) {
        return {
            position: {
                x: view.getFloat32(offset, true),
                y: view.getFloat32(offset + 4, true),
                z: view.getFloat32(offset + 8, true)
            },
            rotation: {
                x: view.getFloat32(offset + 12, true),
                y: view.getFloat32(offset + 16, true),
                z: view.getFloat32(offset + 20, true)
            },
            scale: {
                x: view.getFloat32(offset + 24, true),
                y: view.getFloat32(offset + 28, true),
                z: view.getFloat32(offset + 32, true)
            }
        };
    }

    /**
     * Decompress Depth10b6b frame data using proper algorithm
     * Based on Unity Format2D10BD6BL.cs implementation with precise camera transformation
     */
    decompressFrame(frameData, leftCamera = null, rightCamera = null) {
        if (!frameData || frameData.byteLength === 0) {
            return [];
        }

        const points = [];
        const width = 640;
        const height = 480;
        const nearClip = 0;
        const farClip = 8000;

        try {
            let count = 0;
            let isLeftScreen = true;

            // Process compressed data in 2-byte chunks
            for (let i = 0; i < frameData.byteLength; i += 2) {
                if (i + 1 >= frameData.byteLength) break;

                const first = frameData[i];
                const second = frameData[i + 1];

                // Extract run length (6 bits) and depth (10 bits)
                const runLength = (second >> 2) + 1;
                const depth = ((first) | ((second & 0x03) << 8)) * 2502 >> 8;

                // Apply depth clipping
                if (depth > nearClip && depth < farClip) {
                    for (let j = 0; j < runLength; j++) {
                        if (count >= width * height) break;

                        count++;

                        // パース時サブサンプリング（メモリ最適化）
                        // parseSubsample=2なら2点に1点、=4なら4点に1点のみ処理
                        if (count % this.parseSubsample !== 0) continue;

                        // Calculate x, y coordinates from count
                        const x = (count - 1) % width;
                        const y = Math.floor((count - 1) / width);

                        // ST_Client完全準拠のカメラマトリクス変換を使用
                        const worldPoint = this.transformSTClientCompliant(x, y, depth, isLeftScreen, leftCamera, rightCamera);

                        // ST_Client準拠: パース時は範囲チェックなし、描画時のみフィルタ
                        if (worldPoint) {
                            points.push(worldPoint.x, worldPoint.y, worldPoint.z);
                        }

                        // Limit points per frame for memory efficiency (大容量対応)
                        if (points.length >= STMOVConfig.MAX_POINTS_PER_FRAME) return points;
                    }
                } else {
                    // Skip clipped depths but advance count
                    count += runLength;
                }

                // Switch to right screen after processing left screen
                if (count >= width * height && isLeftScreen) {
                    isLeftScreen = false;
                    count = 0;
                }

                // Stop if we've processed both screens
                if (count >= width * height && !isLeftScreen) {
                    break;
                }
            }
        } catch (error) {
            Logger.error('Frame decompression failed:', error);
        }

        Logger.debug(`Decompressed ${points.length / 3} points`);
        return points;
    }

    /**
     * Transform using camera matrix information from STMOV file
     */
    transformWithCameraMatrix(x, y, depth, isLeftScreen, leftCamera, rightCamera) {
        const camera = isLeftScreen ? leftCamera : rightCamera;

        // Convert depth to meters
        const depthMeters = depth / 1000.0;

        // Camera intrinsics (Kinect default values - should be calibrated)
        const fx = 525.0; // Focal length X
        const fy = 525.0; // Focal length Y
        const cx = 320.0; // Principal point X
        const cy = 240.0; // Principal point Y

        // Convert image coordinates to camera space
        const cameraX = (x - cx) * depthMeters / fx;
        const cameraY = (y - cy) * depthMeters / fy;
        const cameraZ = depthMeters;

        // Apply camera transformation (position + rotation)
        const cos_rx = Math.cos(camera.rotation.x);
        const sin_rx = Math.sin(camera.rotation.x);
        const cos_ry = Math.cos(camera.rotation.y);
        const sin_ry = Math.sin(camera.rotation.y);
        const cos_rz = Math.cos(camera.rotation.z);
        const sin_rz = Math.sin(camera.rotation.z);

        // Rotation matrix (simplified - assuming ZYX order)
        const worldX = camera.position.x + cameraX * cos_ry * cos_rz - cameraY * cos_ry * sin_rz + cameraZ * sin_ry;
        const worldY = camera.position.y + cameraX * (sin_rx * sin_ry * cos_rz + cos_rx * sin_rz) +
                      cameraY * (-sin_rx * sin_ry * sin_rz + cos_rx * cos_rz) - cameraZ * sin_rx * cos_ry;
        const worldZ = camera.position.z + cameraX * (-cos_rx * sin_ry * cos_rz + sin_rx * sin_rz) +
                      cameraY * (cos_rx * sin_ry * sin_rz + sin_rx * cos_rz) + cameraZ * cos_rx * cos_ry;

        // Check if point is within capture volume (0-2m×0-2.4m×0-4m)
        if (worldX >= 0 && worldX <= 2.0 && worldY >= 0 && worldY <= 2.4 && worldZ >= 0 && worldZ <= 4.0) {
            return { x: worldX, y: worldY, z: worldZ };
        }

        return null;
    }

    /**
     * Simple transformation fallback
     */
    transformSimple(x, y, depth, width, height, farClip) {
        const realX = (x / width) * 2.0;  // 0 to 2 meters
        const realY = 2.4 - (y / height) * 2.4; // Flip Y: 2.4 to 0 meters (ground up)
        const realZ = (depth / farClip) * 4.0; // 0 to 4 meters

        return { x: realX, y: realY, z: realZ };
    }

    /**
     * Expanded transformation to fill the capture space properly
     * Fixed axis orientation: depth(4m) should be Z-axis, width(2m) should be X-axis
     */
    transformSimpleExpanded(x, y, depth, width, height, farClip, isLeftScreen) {
        // Direct mapping with corrected axis orientation
        // Image X (640px) corresponds to real-world Z (4m depth)
        // Image Y (480px) corresponds to real-world Y (2.4m height)
        // Depth corresponds to real-world X (2m width)

        const normalizedImageX = x / width;        // 0 to 1 (image horizontal)
        const normalizedImageY = y / height;       // 0 to 1 (image vertical)
        const normalizedDepth = depth / farClip;   // 0 to 1 (sensor depth)

        // Correct axis mapping:
        // X-axis (2m width): controlled by depth from sensor
        // Y-axis (2.4m height): controlled by image Y, flipped
        // Z-axis (4m depth): controlled by image X

        const finalX = normalizedDepth * 2.0;           // Depth → X (0 to 2m width)
        const finalY = (1 - normalizedImageY) * 2.4;    // Image Y → Y (0 to 2.4m height, flipped)
        const finalZ = normalizedImageX * 4.0;          // Image X → Z (0 to 4m depth)

        return { x: finalX, y: finalY, z: finalZ };
    }

    // ============================================================================
    // 【参照実装】Unity専用の座標変換関数について
    // ============================================================================
    // 開発過程で使用されたUnity STMOV_DLL準拠の実装は、
    // コードの可読性向上のため別ファイルに移動しました。
    //
    // 参照実装の場所: public/js/reference-implementations.js
    //   - transformUnityAccurate() - Unity VoxcelTransformer.cs準拠
    //   - getCameraMatrix() - Unity CameraStatus.GetMatrix()準拠
    //
    // 現在の実装では以下を使用しています:
    //   - transformSTClientCompliant() (行571-618)
    //   - createST_ClientCameraMatrix() (行656-732)
    // ============================================================================

    /**
     * 4x4 matrix multiplication
     */
    multiplyMatrix(a, b) {
        const result = new Array(16);
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 4; j++) {
                result[i * 4 + j] = 0;
                for (let k = 0; k < 4; k++) {
                    result[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
                }
            }
        }
        return result;
    }

    /**
     * Matrix4x4 * Vector4 multiplication（行優先形式）
     * Unity Matrix4x4.cs lines 119-136の完全実装
     * vec.x = left.x * right.m[0,0] + left.y * right.m[0,1] + left.z * right.m[0,2] + left.w * right.m[0,3]
     */
    multiplyMatrix4x4(matrix, vector) {
        // 行優先形式: matrix[row*4 + col]
        return {
            x: vector.x * matrix[0*4+0] + vector.y * matrix[0*4+1] + vector.z * matrix[0*4+2] + vector.w * matrix[0*4+3],
            y: vector.x * matrix[1*4+0] + vector.y * matrix[1*4+1] + vector.z * matrix[1*4+2] + vector.w * matrix[1*4+3],
            z: vector.x * matrix[2*4+0] + vector.y * matrix[2*4+1] + vector.z * matrix[2*4+2] + vector.w * matrix[2*4+3],
            w: vector.x * matrix[3*4+0] + vector.y * matrix[3*4+1] + vector.z * matrix[3*4+2] + vector.w * matrix[3*4+3]
        };
    }

    /**
     * ST_Client完全準拠 VoxGrafix::MixDepth実装
     * カメラマトリクス変換を含む完全な座標変換
     */
    transformSTClientCompliant(x, y, depth, isLeftScreen, leftCamera, rightCamera) {
        // ST_Client完全準拠: カメラマトリクス変換を使用
        if (!leftCamera || !rightCamera) {
            Logger.debug('Using fallback transform (camera info unavailable)');
            return this.transformCorrectedSimple(x, y, depth, 640, 480, 8000, isLeftScreen);
        }

        const camera = isLeftScreen ? leftCamera : rightCamera;

        // Step 1: ST_Client正規化座標計算（VoxGrafix::MixDepth準拠）
        // ST_CLIENT_COMPLETE_ANALYSIS.md lines 452-454
        const fx = (320 - x) / 640.0;  // -0.5 to +0.5 (画像中心基準)
        const fy = (240 - y) / 640.0;  // -0.5 to +0.5 (ST_Client: Y軸も640で除算!)
        const fz = depth / 1000.0;     // mm → m変換: 0.0 to 10.0

        // Step 2: ST_Client視錐台変換（透視投影）(lines 462-463)
        const projectedX = fx * fz;
        const projectedY = fy * fz;
        const projectedZ = fz;

        // Step 3: ST_Client カメラマトリクス適用 (line 466)
        const cameraMatrix = this.createST_ClientCameraMatrix(camera);
        const transformedPoint = this.multiplyMatrix4x4(cameraMatrix, {
            x: projectedX,
            y: projectedY,
            z: projectedZ,
            w: 1.0
        });

        // ST_Client準拠: カメラマトリクス変換の結果をそのまま返す
        // St3dData.cpp MixDepth関数: p.x = point[0]; p.y = point[1]; p.z = point[2];
        // オフセット(add_x, add_z)はDrawVoxels関数で描画時に適用される
        // glVertex3f(x + add_x, y + add_y, -(z + add_z))

        // MixDepth関数ではオフセットを適用しない（ST_Client準拠）
        // オフセットはapp.jsのdisplayUnitFrame関数で描画時に適用

        // ST_Client/Unity準拠: カメラマトリクス変換の結果をそのまま返す
        // オフセットやZ軸反転は行わない（OpenGL描画時にZ軸反転のみ実施）

        return {
            x: transformedPoint.x,
            y: transformedPoint.y,
            z: transformedPoint.z  // カメラマトリクス変換結果をそのまま使用
        };

    }

    /**
     * ST_Client完全準拠 VoxGrafix::MixDepth実装（フォールバック）
     * カメラ情報がない場合の簡易変換
     */
    transformCorrectedSimple(x, y, depth, width, height, farClip, isLeftScreen) {
        // Step 1: ST_Client MixDepth正規化座標計算 (lines 452-454)
        const fx = (320 - x) / 640.0;  // -0.5 to +0.5 (画像中心基準)
        const fy = (240 - y) / 640.0;  // -0.5 to +0.5 (Y軸も640で除算!)
        const fz = depth / 1000.0;     // mm → m変換: 0.0 to 10.0

        // Step 2: ST_Client視錐台変換（透視投影）(lines 462-463)
        const projectedX = fx * fz;
        const projectedY = fy * fz;
        const projectedZ = fz;

        // Step 3: 簡易変換結果をそのまま返す（カメラマトリクスなしの場合）
        // ST_Client MixDepth関数準拠: オフセットは描画時に適用

        // デバッグ: 座標変換の値を確認
        if (Math.random() < 0.01) { // サンプリング頻度を上げてログ出力
            Logger.debug(`Debug simple transform: (${x},${y},${depth}) -> projected(${projectedX.toFixed(3)},${projectedY.toFixed(3)},${projectedZ.toFixed(3)})`);
        }

        // ST_Client座標系（右手座標系）
        return {
            x: projectedX,   // X座標（左右）
            y: projectedY,   // Y座標
            z: projectedZ    // Z座標（奥行き、後でOpenGLで反転）
        };
    }

    /**
     * Unity CameraStatus.GetMatrix() 完全準拠のカメラマトリクス生成（行優先形式）
     * CameraStatus.cs lines 60-120の完全実装
     * 変換順序: X回転 → Y回転 → Z回転 → スケール → 平行移動
     */
    createST_ClientCameraMatrix(camera) {
        // 単位行列から開始（行優先形式）
        let matrix = [
            1, 0, 0, 0,  // row 0
            0, 1, 0, 0,  // row 1
            0, 0, 1, 0,  // row 2
            0, 0, 0, 1   // row 3
        ];

        // 1. X軸回転（行優先形式）
        const cosX = Math.cos(camera.rotation.x);
        const sinX = Math.sin(camera.rotation.x);
        const rotX = [
            1,  0,     0,    0,    // row 0
            0,  cosX, -sinX, 0,    // row 1
            0,  sinX,  cosX, 0,    // row 2
            0,  0,     0,    1     // row 3
        ];
        matrix = this.multiplyMatricesRowMajor(rotX, matrix);

        // 2. Y軸回転（行優先形式）
        const cosY = Math.cos(camera.rotation.y);
        const sinY = Math.sin(camera.rotation.y);
        const rotY = [
             cosY, 0,  sinY, 0,    // row 0
             0,    1,  0,    0,    // row 1
            -sinY, 0,  cosY, 0,    // row 2
             0,    0,  0,    1     // row 3
        ];
        matrix = this.multiplyMatricesRowMajor(rotY, matrix);

        // 3. Z軸回転（行優先形式）
        const cosZ = Math.cos(camera.rotation.z);
        const sinZ = Math.sin(camera.rotation.z);
        const rotZ = [
             cosZ, -sinZ, 0, 0,    // row 0
             sinZ,  cosZ, 0, 0,    // row 1
             0,     0,    1, 0,    // row 2
             0,     0,    0, 1     // row 3
        ];
        matrix = this.multiplyMatricesRowMajor(rotZ, matrix);

        // 4. スケール（行優先形式）
        const scale = [
            camera.scale.x, 0, 0, 0,   // row 0
            0, camera.scale.y, 0, 0,   // row 1
            0, 0, camera.scale.z, 0,   // row 2
            0, 0, 0, 1                 // row 3
        ];
        matrix = this.multiplyMatricesRowMajor(scale, matrix);

        // 5. 平行移動（行優先形式）
        const trans = [
            1, 0, 0, camera.position.x,   // row 0
            0, 1, 0, camera.position.y,   // row 1
            0, 0, 1, camera.position.z,   // row 2
            0, 0, 0, 1                    // row 3
        ];
        matrix = this.multiplyMatricesRowMajor(trans, matrix);

        return matrix;
    }

    /**
     * 4x4行列の乗算（行優先形式）
     * Unity Matrix4x4.cs lines 87-103の完全実装
     */
    multiplyMatricesRowMajor(a, b) {
        const result = new Array(16);
        for (let i = 0; i < 4; i++) {          // 行ループ
            for (let j = 0; j < 4; j++) {      // 列ループ
                result[i * 4 + j] = 0;         // 行優先アクセス: row i, col j
                for (let k = 0; k < 4; k++) {
                    result[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
                }
            }
        }
        return result;
    }

    // ============================================================================
    // 【削除済み関数】isInCaptureArea
    // ST_Client準拠のため、パース時の範囲チェックを廃止しました。
    // 範囲フィルタリングは描画時（app.js displayUnitFrame関数）のみ実施します。
    // 削除日: 2025-10-02 (SYSTEM_REVIEW_REPORT.md 推奨改善アクション #1)
    // ============================================================================
}