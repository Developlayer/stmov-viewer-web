/**
 * STMOV Parser - 参照実装コレクション
 *
 * このファイルには開発過程で使用された実装が保存されています。
 * 現在のアプリケーションでは使用されていませんが、
 * 学習・参照・比較用途のために保持しています。
 *
 * 【重要】
 * これらの関数は現在使用されていません。
 * 本番コードでは stmov-parser.js の以下の関数を使用してください:
 *   - transformSTClientCompliant() (ST_Client準拠の座標変換)
 *   - createST_ClientCameraMatrix() (ST_Client準拠のカメラマトリクス)
 *
 * 作成日: 2025-10-03
 * 理由: コードの可読性向上とメンテナンス性改善
 */

// ============================================================================
// Unity STMOV_DLL 準拠の実装
// ============================================================================

/**
 * Unity VoxcelTransformer.cs accurate implementation
 * Unityで使用されている正確な座標変換を実装
 *
 * 【注意】
 * Unity版はY軸正規化に÷480を使用しますが、ST_Clientは÷640を使用します。
 *
 * 参照元:
 * - Unity STMOV_DLL/SportsTimeMachineMovie/Data/Transformer/VoxcelTransformer.cs
 * - Lines 76-84
 *
 * @param {number} x - 画像X座標 (0-639)
 * @param {number} y - 画像Y座標 (0-479)
 * @param {number} depth - 深度値 (mm)
 * @param {boolean} isLeftScreen - 左カメラか
 * @param {Object} leftCamera - 左カメラ情報
 * @param {Object} rightCamera - 右カメラ情報
 * @returns {Object} {x, y, z} 3D座標
 */
function transformUnityAccurate(x, y, depth, isLeftScreen, leftCamera, rightCamera) {
    const RESOLUTION_WIDTH = 640;
    const RESOLUTION_HEIGHT = 480;

    // Use fallback if camera info not available
    if (!leftCamera || !rightCamera) {
        return transformSimpleExpanded(x, y, depth, RESOLUTION_WIDTH, RESOLUTION_HEIGHT, 8000, isLeftScreen);
    }

    const camera = isLeftScreen ? leftCamera : rightCamera;

    // Unity VoxcelTransformer calculation (lines 76-84)
    const vec = {
        x: ((RESOLUTION_WIDTH/2) - x) / RESOLUTION_WIDTH,
        y: ((RESOLUTION_HEIGHT/2) - y) / RESOLUTION_HEIGHT,
        z: depth / 1000.0  // Convert to meters
    };

    // Vector4 vec4 = new Vector4(vec.x * vec.z, vec.y * vec.z, vec.z, 1.0f);
    const vec4 = {
        x: vec.x * vec.z,
        y: vec.y * vec.z,
        z: vec.z,
        w: 1.0
    };

    // Apply camera matrix transformation
    const transformedPoint = multiplyMatrix4x4(getCameraMatrix(camera), vec4);

    return {
        x: transformedPoint.x,
        y: transformedPoint.y,
        z: transformedPoint.z
    };
}

/**
 * Unity CameraStatus.GetMatrix() implementation
 * Unityのカメラマトリクス生成を再現
 *
 * 【注意】
 * 現在は createST_ClientCameraMatrix 関数を使用しています（行優先形式）
 * Unity版は列優先形式のマトリクスを使用します。
 *
 * 参照元:
 * - Unity STMOV_DLL/SportsTimeMachineMovie/Data/CameraStatus.cs
 * - GetMatrix() メソッド (lines 71-118)
 *
 * @param {Object} camera - カメラ情報オブジェクト
 * @param {Object} camera.rotation - 回転 {x, y, z}
 * @param {Object} camera.scale - 拡縮 {x, y, z}
 * @param {Object} camera.position - 位置 {x, y, z}
 * @returns {Array} 4x4変換マトリクス（列優先、16要素配列）
 */
function getCameraMatrix(camera) {
    // Start with identity matrix
    let mat = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ];

    // X軸回転 (lines 71-79)
    const cosX = Math.cos(camera.rotation.x);
    const sinX = Math.sin(camera.rotation.x);
    const rotX = [
        1, 0, 0, 0,
        0, cosX, -sinX, 0,
        0, sinX, cosX, 0,
        0, 0, 0, 1
    ];
    mat = multiplyMatrix(rotX, mat);

    // Y軸回転 (lines 82-90)
    const cosY = Math.cos(camera.rotation.y);
    const sinY = Math.sin(camera.rotation.y);
    const rotY = [
        cosY, 0, sinY, 0,
        0, 1, 0, 0,
        -sinY, 0, cosY, 0,
        0, 0, 0, 1
    ];
    mat = multiplyMatrix(rotY, mat);

    // Z軸回転 (lines 93-101)
    const cosZ = Math.cos(camera.rotation.z);
    const sinZ = Math.sin(camera.rotation.z);
    const rotZ = [
        cosZ, -sinZ, 0, 0,
        sinZ, cosZ, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ];
    mat = multiplyMatrix(rotZ, mat);

    // 拡縮 (lines 104-110)
    const scale = [
        camera.scale.x, 0, 0, 0,
        0, camera.scale.y, 0, 0,
        0, 0, camera.scale.z, 0,
        0, 0, 0, 1
    ];
    mat = multiplyMatrix(scale, mat);

    // 平行移動 (lines 112-118)
    const translate = [
        1, 0, 0, camera.position.x,
        0, 1, 0, camera.position.y,
        0, 0, 1, camera.position.z,
        0, 0, 0, 1
    ];
    mat = multiplyMatrix(translate, mat);

    return mat;
}

// ============================================================================
// ヘルパー関数（参照実装内で使用）
// ============================================================================

/**
 * 4x4マトリクス同士の乗算
 * Unity版の列優先形式マトリクス演算
 *
 * @param {Array} a - 4x4マトリクス（16要素配列）
 * @param {Array} b - 4x4マトリクス（16要素配列）
 * @returns {Array} 乗算結果（16要素配列）
 */
function multiplyMatrix(a, b) {
    const result = new Array(16);
    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
            result[i * 4 + j] =
                a[i * 4 + 0] * b[0 * 4 + j] +
                a[i * 4 + 1] * b[1 * 4 + j] +
                a[i * 4 + 2] * b[2 * 4 + j] +
                a[i * 4 + 3] * b[3 * 4 + j];
        }
    }
    return result;
}

/**
 * 4x4マトリクスとベクトルの乗算
 *
 * @param {Array} mat - 4x4マトリクス（16要素配列）
 * @param {Object} vec - ベクトル {x, y, z, w}
 * @returns {Object} 変換後のベクトル {x, y, z, w}
 */
function multiplyMatrix4x4(mat, vec) {
    return {
        x: mat[0] * vec.x + mat[1] * vec.y + mat[2] * vec.z + mat[3] * vec.w,
        y: mat[4] * vec.x + mat[5] * vec.y + mat[6] * vec.z + mat[7] * vec.w,
        z: mat[8] * vec.x + mat[9] * vec.y + mat[10] * vec.z + mat[11] * vec.w,
        w: mat[12] * vec.x + mat[13] * vec.y + mat[14] * vec.z + mat[15] * vec.w
    };
}

/**
 * 簡易座標変換（フォールバック用）
 * カメラ情報がない場合に使用
 *
 * @param {number} x - 画像X座標
 * @param {number} y - 画像Y座標
 * @param {number} depth - 深度値
 * @param {number} width - 画像幅
 * @param {number} height - 画像高さ
 * @param {number} farClip - 最大深度値
 * @param {boolean} isLeftScreen - 左カメラか
 * @returns {Object} {x, y, z} 3D座標
 */
function transformSimpleExpanded(x, y, depth, width, height, farClip, isLeftScreen) {
    const normalizedImageX = x / width;
    const normalizedImageY = y / height;
    const normalizedDepth = depth / farClip;

    const finalX = normalizedDepth * 2.0;
    const finalY = (1 - normalizedImageY) * 2.4;
    const finalZ = normalizedImageX * 4.0;

    return { x: finalX, y: finalY, z: finalZ };
}

// ============================================================================
// ST_ClientとUnityの主な違い
// ============================================================================

/**
 * 座標変換アルゴリズムの比較
 *
 * Unity版 (VoxcelTransformer.cs):
 *   - Y軸正規化: (240 - y) / 480
 *   - マトリクス形式: 列優先
 *   - 参照: STMOV_DLL/SportsTimeMachineMovie/Data/Transformer/VoxcelTransformer.cs
 *
 * ST_Client版 (VoxGrafix::MixDepth):
 *   - Y軸正規化: (240 - y) / 640  ← 重要な違い！
 *   - マトリクス形式: 行優先
 *   - 参照: ST_Client/src/St3dData.cpp lines 79-117
 *
 * 現在の実装 (stmov-parser.js):
 *   - transformSTClientCompliant() を使用
 *   - ST_Client準拠のため、Y軸正規化は ÷640
 *   - より正確な点群表示を実現
 */

// ============================================================================
// 使用方法（参照用）
// ============================================================================

/**
 * このファイルの関数を使用する場合（非推奨）:
 *
 * // HTMLで読み込み
 * <script src="js/reference-implementations.js"></script>
 *
 * // 関数呼び出し
 * const point = transformUnityAccurate(320, 240, 1500, true, leftCam, rightCam);
 * console.log(point);  // {x: ..., y: ..., z: ...}
 *
 * 【推奨】
 * 実際のアプリケーションでは stmov-parser.js の STMOVParser クラスを使用してください。
 * これらの関数は学習・研究目的のみに使用することをお勧めします。
 */
