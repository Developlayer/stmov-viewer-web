/**
 * STMOV Parser - Sports Time Machine Movie File Parser
 * Parses the proprietary STMOV binary format used by Sports Time Machine
 */

class STMOVParser {
    constructor() {
        this.signature = null;
        this.version = null;
        this.frameCount = 0;
        this.totalTime = 0;
        this.compressionFormat = null;
        this.leftCamera = null;
        this.rightCamera = null;
        this.dotSize = 0;
        this.frames = [];
    }

    /**
     * Parse STMOV file header
     * @param {ArrayBuffer} buffer - STMOV file data
     * @returns {Object} Header information
     */
    parseHeader(buffer) {
        const view = new DataView(buffer);
        let offset = 0;

        // File signature (6 bytes) - should be "STMV  "
        this.signature = new TextDecoder().decode(new Uint8Array(buffer, offset, 6));
        offset += 6;

        // Version (2 bytes) - Major, Minor
        this.version = {
            major: view.getUint8(offset),
            minor: view.getUint8(offset + 1)
        };
        offset += 2;

        // Total frame count (4 bytes, little-endian)
        this.frameCount = view.getUint32(offset, true);
        offset += 4;

        // Total time in milliseconds (4 bytes, little-endian)
        this.totalTime = view.getUint32(offset, true);
        offset += 4;

        // Compression format name (16 bytes ASCII)
        this.compressionFormat = new TextDecoder().decode(
            new Uint8Array(buffer, offset, 16)
        ).replace(/\0+$/, ''); // Remove null padding
        offset += 16;

        // Left camera info (36 bytes = 9 floats)
        this.leftCamera = this.parseCamera(view, offset);
        offset += 36;

        // Right camera info (36 bytes = 9 floats)
        this.rightCamera = this.parseCamera(view, offset);
        offset += 36;

        // Dot size (4 bytes float)
        this.dotSize = view.getFloat32(offset, true);
        offset += 4;

        return {
            signature: this.signature,
            version: this.version,
            frameCount: this.frameCount,
            totalTime: this.totalTime,
            compressionFormat: this.compressionFormat,
            leftCamera: this.leftCamera,
            rightCamera: this.rightCamera,
            dotSize: this.dotSize,
            dataStartOffset: offset
        };
    }

    /**
     * Parse camera information (9 floats: position, rotation, scale)
     * @param {DataView} view - Data view
     * @param {number} offset - Starting offset
     * @returns {Object} Camera information
     */
    parseCamera(view, offset) {
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
     * Decompress depth data using depth10b6b format
     * @param {Uint8Array} compressedData - Compressed depth data
     * @returns {Array} Array of 3D points
     */
    decompressDepth10b6b(compressedData) {
        const points = [];
        let i = 0;

        while (i < compressedData.length - 1) {
            const first = compressedData[i];
            const second = compressedData[i + 1];

            // Extract run length (6 bits from second byte) + 1
            const runLength = (second >> 2) + 1;

            // Extract depth value (10 bits total)
            const depth = (first | ((second & 0x03) << 8)) * 2502 >> 8;

            // Add points for the run length
            for (let j = 0; j < runLength; j++) {
                if (depth > 0) { // Only add valid depth points
                    points.push({
                        x: Math.random() * 640 - 320, // Placeholder X coordinate
                        y: Math.random() * 480 - 240, // Placeholder Y coordinate
                        z: depth
                    });
                }
            }

            i += 2;
        }

        return points;
    }

    /**
     * Parse a single frame from the STMOV data
     * @param {DataView} view - Data view
     * @param {number} offset - Starting offset
     * @returns {Object} Frame data and next offset
     */
    parseFrame(view, offset) {
        // This is a simplified frame parser
        // The actual frame structure would need more detailed analysis

        // Assuming each frame has a header with size info
        const frameSize = view.getUint32(offset, true);
        offset += 4;

        // Get compressed data
        const compressedData = new Uint8Array(view.buffer, offset, frameSize);
        offset += frameSize;

        // Decompress the frame data
        const points = this.decompressDepth10b6b(compressedData);

        return {
            points: points,
            nextOffset: offset
        };
    }

    /**
     * Parse entire STMOV file
     * @param {ArrayBuffer} buffer - STMOV file data
     * @returns {Object} Parsed STMOV data
     */
    async parse(buffer) {
        console.log('Parsing STMOV file, size:', buffer.byteLength);

        // Parse header
        const header = this.parseHeader(buffer);
        console.log('Header:', header);

        if (header.signature !== 'STMV  ') {
            throw new Error('Invalid STMOV file signature');
        }

        // Parse frames (simplified for now)
        const view = new DataView(buffer);
        let offset = header.dataStartOffset;

        // For now, just create sample data based on the header info
        this.frames = this.generateSampleFrames(header.frameCount);

        return {
            header: header,
            frames: this.frames,
            metadata: {
                duration: header.totalTime,
                frameRate: header.frameCount / (header.totalTime / 1000),
                compression: header.compressionFormat
            }
        };
    }

    /**
     * Generate sample frames for testing (until proper frame parsing is implemented)
     * @param {number} frameCount - Number of frames to generate
     * @returns {Array} Array of sample frames
     */
    generateSampleFrames(frameCount) {
        const frames = [];
        const maxFrames = Math.min(frameCount, 100); // Limit for performance

        for (let i = 0; i < maxFrames; i++) {
            const points = [];
            const pointCount = 1000 + Math.random() * 2000; // Random point count

            for (let j = 0; j < pointCount; j++) {
                points.push({
                    x: (Math.random() - 0.5) * 400,
                    y: (Math.random() - 0.5) * 300,
                    z: Math.random() * 200 + 100,
                    color: {
                        r: Math.random(),
                        g: Math.random(),
                        b: Math.random()
                    }
                });
            }

            frames.push({
                index: i,
                timestamp: (i / maxFrames) * this.totalTime,
                points: points
            });
        }

        return frames;
    }
}

// Export for both Node.js and browser
if (typeof module !== 'undefined' && module.exports) {
    module.exports = STMOVParser;
} else {
    window.STMOVParser = STMOVParser;
}