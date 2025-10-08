/**
 * STMOV Viewer Local Server
 * Simple Express.js server to serve the STMOV viewer application
 */

// 環境変数を読み込む（.envファイルから）
require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024 * 1024,  // 1GB per file
        files: 6  // Maximum 6 files (total: 6GB max)
    },
    fileFilter: (req, file, cb) => {
        // Allow both .stmov and .zip files
        const allowedExtensions = ['.stmov', '.zip'];
        const ext = path.extname(file.originalname).toLowerCase();

        if (allowedExtensions.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`許可されていないファイル形式です。${allowedExtensions.join(', ')}のみアップロード可能です`), false);
        }
    }
});

// Routes

/**
 * サーバータイムスタンプを生成
 * @returns {Object} 複数形式のタイムスタンプ
 */
function getServerTimestamp() {
    const now = new Date();

    return {
        iso: now.toISOString(),                              // UTC ISO形式
        unix: now.getTime(),                                 // UNIX時刻（ミリ秒）
        local: now.toLocaleString('ja-JP', {                // 日本のローカル時刻
            timeZone: 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        }),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone  // サーバーのタイムゾーン
    };
}

// Serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: getServerTimestamp(),
        version: '1.0.0',
        uptime: process.uptime(),  // サーバー稼働時間（秒）
        debugMode: DEBUG_MODE  // デバッグモード設定（フロントエンドで使用）
    });
});

// ============================================================
// 以下のエンドポイントは現在未使用です（将来の機能拡張用）
// 現在のアプリはブラウザのFileReader APIを使用してファイルを読み込むため、
// サーバーアップロード機能は使用していません
// ============================================================

/*
// Upload STMOV files
app.post('/upload', upload.array('stmov-files'), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({
                error: 'No STMOV files uploaded'
            });
        }

        const uploadedFiles = req.files.map(file => ({
            filename: file.filename,
            originalName: file.originalname,
            size: file.size,
            path: file.path
        }));

        res.json({
            success: true,
            files: uploadedFiles,
            message: `${uploadedFiles.length} STMOV file(s) uploaded successfully`
        });

        console.log(`Uploaded ${uploadedFiles.length} STMOV files:`, uploadedFiles.map(f => f.originalName));

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            error: 'Failed to upload files',
            details: error.message
        });
    }
});

// Get uploaded files list
app.get('/files', (req, res) => {
    try {
        const uploadsDir = path.join(__dirname, '../uploads');

        if (!fs.existsSync(uploadsDir)) {
            return res.json({ files: [] });
        }

        const files = fs.readdirSync(uploadsDir)
            .filter(file => file.toLowerCase().endsWith('.stmov'))
            .map(file => {
                const filePath = path.join(uploadsDir, file);
                const stats = fs.statSync(filePath);

                return {
                    filename: file,
                    size: stats.size,
                    uploadDate: stats.ctime,
                    path: `/uploads/${file}`
                };
            })
            .sort((a, b) => new Date(b.uploadDate) - new Date(a.uploadDate));

        res.json({ files });

    } catch (error) {
        console.error('Error reading files:', error);
        res.status(500).json({
            error: 'Failed to read files',
            details: error.message
        });
    }
});

// Serve uploaded files
app.get('/uploads/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(__dirname, '../uploads', filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                error: 'File not found'
            });
        }

        // Set appropriate headers for STMOV files
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

    } catch (error) {
        console.error('Error serving file:', error);
        res.status(500).json({
            error: 'Failed to serve file',
            details: error.message
        });
    }
});

// Delete uploaded file
app.delete('/files/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        const filePath = path.join(__dirname, '../uploads', filename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                error: 'File not found'
            });
        }

        fs.unlinkSync(filePath);
        res.json({
            success: true,
            message: `File ${filename} deleted successfully`
        });

        console.log(`Deleted file: ${filename}`);

    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({
            error: 'Failed to delete file',
            details: error.message
        });
    }
});

// API endpoint to get sample STMOV files from reference folder
app.get('/api/sample-files', (req, res) => {
    try {
        const referenceDir = path.join(__dirname, '../reference');

        if (!fs.existsSync(referenceDir)) {
            return res.json({ files: [] });
        }

        const files = [];

        // Recursively find STMOV files
        function findSTMOVFiles(dir, relativePath = '') {
            const items = fs.readdirSync(dir);

            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stats = fs.statSync(fullPath);

                if (stats.isDirectory()) {
                    findSTMOVFiles(fullPath, path.join(relativePath, item));
                } else if (item.toLowerCase().endsWith('.stmov')) {
                    files.push({
                        filename: item,
                        relativePath: path.join(relativePath, item),
                        size: stats.size,
                        path: `/api/sample-files/${encodeURIComponent(path.join(relativePath, item))}`
                    });
                }
            }
        }

        findSTMOVFiles(referenceDir);

        res.json({ files });

    } catch (error) {
        console.error('Error reading sample files:', error);
        res.status(500).json({
            error: 'Failed to read sample files',
            details: error.message
        });
    }
});

// Serve sample STMOV files
app.get('/api/sample-files/:path(*)', (req, res) => {
    try {
        const relativePath = decodeURIComponent(req.params.path);
        const filePath = path.join(__dirname, '../reference', relativePath);

        if (!fs.existsSync(filePath) || !filePath.toLowerCase().endsWith('.stmov')) {
            return res.status(404).json({
                error: 'Sample file not found'
            });
        }

        // Set appropriate headers
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${path.basename(filePath)}"`);

        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

    } catch (error) {
        console.error('Error serving sample file:', error);
        res.status(500).json({
            error: 'Failed to serve sample file',
            details: error.message
        });
    }
});
*/

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);

    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                error: 'File too large',
                details: 'File size exceeds the limit'
            });
        }
    }

    res.status(500).json({
        error: 'Internal server error',
        details: error.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not found',
        path: req.path
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 STMOV Viewer server running on http://localhost:${PORT}`);
    console.log(`📁 Serving files from: ${path.join(__dirname, '../public')}`);
    console.log(`📂 Upload directory: ${path.join(__dirname, '../uploads')}`);
    console.log(`🎬 Sample files: ${path.join(__dirname, '../reference')}`);
    console.log(`🔧 Environment: ${NODE_ENV}`);
    console.log(`🐛 Debug mode: ${DEBUG_MODE ? 'ON' : 'OFF'}`);
});

module.exports = app;