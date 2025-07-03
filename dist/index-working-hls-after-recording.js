"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ws_1 = require("ws");
const http_1 = require("http");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const uuid_1 = require("uuid");
const child_process_1 = require("child_process");
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const wss = new ws_1.WebSocketServer({ server });
// FFmpeg path
const FFMPEG_PATH = 'C:/ffmpeg/bin/ffmpeg.exe';
// Serve static files
app.use(express_1.default.static('public'));
// Store for active video recordings
const recordings = new Map();
// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const hlsDir = path.join(__dirname, 'hls');
const formatsDir = path.join(__dirname, 'formats');
[uploadsDir, hlsDir, formatsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});
// Quality presets for transcoding
const qualityPresets = [
    { name: '1080p', width: 1920, height: 1080, bitrate: '5000k', audioBitrate: '192k' },
    { name: '720p', width: 1280, height: 720, bitrate: '2500k', audioBitrate: '128k' },
    { name: '480p', width: 854, height: 480, bitrate: '1000k', audioBitrate: '96k' },
    { name: '360p', width: 640, height: 360, bitrate: '500k', audioBitrate: '64k' }
];
// Format presets
const formatPresets = [
    { name: 'mp4', codec: 'libx264', container: 'mp4' },
    { name: 'webm', codec: 'libvpx-vp9', container: 'webm' },
    { name: 'mkv', codec: 'libx264', container: 'mkv' }
];
// Check if FFmpeg is available
function checkFFmpeg() {
    return new Promise((resolve) => {
        const ffmpeg = (0, child_process_1.spawn)(FFMPEG_PATH, ['-version']);
        ffmpeg.on('close', (code) => {
            resolve(code === 0);
        });
        ffmpeg.on('error', () => {
            resolve(false);
        });
    });
}
// // Transcoding function
// async function transcodeVideo(inputPath: string, outputDir: string, baseFilename: string): Promise<void> {
//   const transcodePromises: Promise<void>[] = [];
//   // Create HLS adaptive bitrate streaming
//   const hlsOutputDir = path.join(hlsDir, baseFilename);
//   if (!fs.existsSync(hlsOutputDir)) {
//     fs.mkdirSync(hlsOutputDir, { recursive: true });
//   }
//   // HLS Master playlist generation
//   const hlsPromise = new Promise<void>((resolve, reject) => {
//     const hlsArgs = [
//       '-i', inputPath,
//       '-c:v', 'libx264',
//       '-c:a', 'aac',
//       '-f', 'hls',
//       '-hls_time', '10',
//       '-hls_playlist_type', 'vod',
//       '-hls_segment_filename', path.join(hlsOutputDir, 'segment_%03d.ts'),
//       '-master_pl_name', 'master.m3u8',
//       '-var_stream_map', 'v:0,a:0 v:1,a:1 v:2,a:2 v:3,a:3',
//       '-vf', 'scale=w=-2:h=1080',
//       '-b:v:0', '5000k', '-maxrate:v:0', '5350k', '-bufsize:v:0', '7500k',
//       '-vf', 'scale=w=-2:h=720',
//       '-b:v:1', '2500k', '-maxrate:v:1', '2675k', '-bufsize:v:1', '3750k',
//       '-vf', 'scale=w=-2:h=480',
//       '-b:v:2', '1000k', '-maxrate:v:2', '1070k', '-bufsize:v:2', '1500k',
//       '-vf', 'scale=w=-2:h=360',
//       '-b:v:3', '500k', '-maxrate:v:3', '535k', '-bufsize:v:3', '750k',
//       path.join(hlsOutputDir, 'stream_%v.m3u8')
//     ];
//     const ffmpegHLS = spawn(FFMPEG_PATH, hlsArgs);
//     ffmpegHLS.stderr.on('data', (data) => {
//       console.log(`HLS transcoding: ${data}`);
//     });
//     ffmpegHLS.on('close', (code) => {
//       if (code === 0) {
//         console.log(`HLS transcoding completed for ${baseFilename}`);
//         resolve();
//       } else {
//         reject(new Error(`HLS transcoding failed with code ${code}`));
//       }
//     });
//     ffmpegHLS.on('error', reject);
//   });
//   transcodePromises.push(hlsPromise);
//   // Create different quality versions
// //   for (const quality of qualityPresets) {
// //     for (const format of formatPresets) {
// //       const outputPath = path.join(outputDir, `${baseFilename}_${quality.name}.${format.container}`);
// //       const transcodePromise = new Promise<void>((resolve, reject) => {
// //         const args = [
// //           '-i', inputPath,
// //           '-c:v', format.codec,
// //           '-b:v', quality.bitrate,
// //           '-c:a', 'aac',
// //           '-b:a', quality.audioBitrate,
// //           '-vf', `scale=${quality.width}:${quality.height}`,
// //           '-preset', 'medium',
// //           '-crf', '23',
// //           '-movflags', '+faststart',
// //           outputPath
// //         ];
// //         const ffmpeg = spawn(FFMPEG_PATH, args);
// //         ffmpeg.stderr.on('data', (data) => {
// //           console.log(`Transcoding ${quality.name} ${format.name}: ${data}`);
// //         });
// //         ffmpeg.on('close', (code) => {
// //           if (code === 0) {
// //             console.log(`Transcoded ${quality.name} ${format.name} for ${baseFilename}`);
// //             resolve();
// //           } else {
// //             reject(new Error(`Transcoding failed for ${quality.name} ${format.name}`));
// //           }
// //         });
// //         ffmpeg.on('error', reject);
// //       });
// //       transcodePromises.push(transcodePromise);
// //     }
// //   }
//   // Wait for all transcoding to complete
//   await Promise.all(transcodePromises);
// }
function transcodeVideo(inputPath, outputDir, baseFilename) {
    return __awaiter(this, void 0, void 0, function* () {
        const hlsOutputDir = path.join(hlsDir, baseFilename);
        if (!fs.existsSync(hlsOutputDir)) {
            fs.mkdirSync(hlsOutputDir, { recursive: true });
        }
        const renditions = [
            { name: '360p', width: 640, height: 360, bitrate: 500000, audioBitrate: 64000 },
            { name: '480p', width: 854, height: 480, bitrate: 1000000, audioBitrate: 96000 },
            { name: '720p', width: 1280, height: 720, bitrate: 2500000, audioBitrate: 128000 },
            { name: '1080p', width: 1920, height: 1080, bitrate: 5000000, audioBitrate: 192000 }
        ];
        const ffmpegPromises = renditions.map(rendition => {
            return new Promise((resolve, reject) => {
                const outputPlaylist = `${rendition.name}.m3u8`;
                const outputSegmentPattern = `${rendition.name}_%03d.ts`;
                const args = [
                    '-i', inputPath,
                    '-vf', `scale=w=${rendition.width}:h=${rendition.height}`,
                    '-c:v', 'libx264',
                    '-b:v', `${rendition.bitrate}`,
                    '-c:a', 'aac',
                    '-b:a', `${rendition.audioBitrate}`,
                    '-ac', '2',
                    '-preset', 'fast',
                    '-f', 'hls',
                    '-hls_time', '10',
                    '-hls_segment_filename', path.join(hlsOutputDir, outputSegmentPattern),
                    path.join(hlsOutputDir, outputPlaylist)
                ];
                const ffmpeg = (0, child_process_1.spawn)(FFMPEG_PATH, args);
                ffmpeg.stderr.on('data', (data) => {
                    console.log(`FFmpeg (${rendition.name}): ${data}`);
                });
                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        console.log(`${rendition.name} HLS transcoding completed`);
                        resolve();
                    }
                    else {
                        reject(new Error(`FFmpeg failed for ${rendition.name} with code ${code}`));
                    }
                });
                ffmpeg.on('error', reject);
            });
        });
        // Wait for all renditions to complete
        yield Promise.all(ffmpegPromises);
        // Create master playlist
        const masterPlaylistPath = path.join(hlsOutputDir, 'master.m3u8');
        const masterPlaylist = [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            ...renditions.map(r => {
                const bandwidth = r.bitrate + r.audioBitrate;
                return `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${r.width}x${r.height}
${r.name}.m3u8`;
            })
        ].join('\n');
        fs.writeFileSync(masterPlaylistPath, masterPlaylist);
        console.log(`Master playlist created at ${masterPlaylistPath}`);
    });
}
// Generate video info
function getVideoInfo(filePath) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            const args = [
                '-i', filePath,
                '-f', 'null',
                '-'
            ];
            const ffmpeg = (0, child_process_1.spawn)(FFMPEG_PATH, args);
            let stderr = '';
            ffmpeg.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            ffmpeg.on('close', () => {
                const durationMatch = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
                const resolutionMatch = stderr.match(/(\d{3,4})x(\d{3,4})/);
                const bitrateMatch = stderr.match(/bitrate: (\d+) kb\/s/);
                const info = {
                    duration: durationMatch ? `${durationMatch[1]}:${durationMatch[2]}:${durationMatch[3]}` : 'Unknown',
                    resolution: resolutionMatch ? `${resolutionMatch[1]}x${resolutionMatch[2]}` : 'Unknown',
                    bitrate: bitrateMatch ? `${bitrateMatch[1]} kb/s` : 'Unknown'
                };
                resolve(info);
            });
            ffmpeg.on('error', reject);
        });
    });
}
wss.on('connection', (ws) => {
    console.log('Client connected');
    let recordingId = null;
    ws.on('message', (data) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const message = JSON.parse(data.toString());
            switch (message.type) {
                case 'start-recording':
                    recordingId = (0, uuid_1.v4)();
                    const filename = `video_${Date.now()}.webm`;
                    recordings.set(recordingId, {
                        chunks: [],
                        startTime: Date.now(),
                        filename,
                        status: 'recording'
                    });
                    ws.send(JSON.stringify({
                        type: 'recording-started',
                        recordingId,
                        filename
                    }));
                    console.log(`Started recording: ${filename}`);
                    break;
                case 'video-chunk':
                    if (recordingId && recordings.has(recordingId)) {
                        const chunk = Buffer.from(message.data, 'base64');
                        recordings.get(recordingId).chunks.push(chunk);
                    }
                    break;
                case 'stop-recording':
                    if (recordingId && recordings.has(recordingId)) {
                        const recording = recordings.get(recordingId);
                        recording.status = 'processing';
                        const videoBuffer = Buffer.concat(recording.chunks);
                        const inputFilePath = path.join(uploadsDir, recording.filename);
                        const baseFilename = path.basename(recording.filename, path.extname(recording.filename));
                        const outputDir = path.join(formatsDir, baseFilename);
                        // Create output directory
                        if (!fs.existsSync(outputDir)) {
                            fs.mkdirSync(outputDir, { recursive: true });
                        }
                        // Save original file
                        fs.writeFileSync(inputFilePath, videoBuffer);
                        const duration = Date.now() - recording.startTime;
                        const fileSize = videoBuffer.length;
                        ws.send(JSON.stringify({
                            type: 'processing-started',
                            filename: recording.filename,
                            duration: duration,
                            fileSize: fileSize
                        }));
                        // Start transcoding process
                        try {
                            const ffmpegAvailable = yield checkFFmpeg();
                            if (!ffmpegAvailable) {
                                throw new Error('FFmpeg not available');
                            }
                            yield transcodeVideo(inputFilePath, outputDir, baseFilename);
                            // Get video info
                            const videoInfo = yield getVideoInfo(inputFilePath);
                            recording.status = 'completed';
                            ws.send(JSON.stringify({
                                type: 'processing-completed',
                                filename: recording.filename,
                                baseFilename: baseFilename,
                                duration: duration,
                                fileSize: fileSize,
                                videoInfo: videoInfo,
                                availableFormats: getAvailableFormats(baseFilename)
                            }));
                            console.log(`Processing completed for: ${recording.filename}`);
                        }
                        catch (error) {
                            console.error('Transcoding error:', error);
                            recording.status = 'error';
                            const errorMessage = error instanceof Error ? error.message : 'Unknown transcoding error';
                            ws.send(JSON.stringify({
                                type: 'processing-error',
                                filename: recording.filename,
                                error: errorMessage
                            }));
                        }
                        recordings.delete(recordingId);
                        recordingId = null;
                    }
                    break;
                default:
                    console.log('Unknown message type:', message.type);
            }
        }
        catch (error) {
            console.error('Error processing message:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
            ws.send(JSON.stringify({
                type: 'error',
                message: errorMessage
            }));
        }
    }));
    ws.on('close', () => {
        console.log('Client disconnected');
        if (recordingId && recordings.has(recordingId)) {
            recordings.delete(recordingId);
        }
    });
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});
// Get available formats for a video
function getAvailableFormats(baseFilename) {
    const formats = [];
    const videoDir = path.join(formatsDir, baseFilename);
    if (fs.existsSync(videoDir)) {
        const files = fs.readdirSync(videoDir);
        files.forEach(file => {
            const filePath = path.join(videoDir, file);
            const stats = fs.statSync(filePath);
            const parts = file.split('_');
            const quality = parts[parts.length - 1].split('.')[0];
            const format = path.extname(file).slice(1);
            formats.push({
                filename: file,
                quality: quality,
                format: format,
                size: stats.size,
                path: `/api/video/${baseFilename}/${file}`
            });
        });
    }
    // Add HLS streaming option
    const hlsPath = path.join(hlsDir, baseFilename, 'master.m3u8');
    if (fs.existsSync(hlsPath)) {
        formats.push({
            filename: 'master.m3u8',
            quality: 'adaptive',
            format: 'hls',
            size: 0,
            path: `/api/hls/${baseFilename}/master.m3u8`,
            streaming: true
        });
    }
    return formats;
}
// API endpoint to list all videos
app.get('/api/videos', (req, res) => {
    try {
        const videos = [];
        // Get original files
        const originalFiles = fs.readdirSync(uploadsDir)
            .filter(file => file.endsWith('.webm'));
        originalFiles.forEach(file => {
            const stats = fs.statSync(path.join(uploadsDir, file));
            const baseFilename = path.basename(file, path.extname(file));
            const availableFormats = getAvailableFormats(baseFilename);
            videos.push({
                baseFilename: baseFilename,
                originalFile: file,
                size: stats.size,
                created: stats.birthtime,
                formats: availableFormats,
                hasHLS: availableFormats.some(f => f.format === 'hls')
            });
        });
        res.json(videos);
    }
    catch (error) {
        console.error('Error listing videos:', error);
        res.status(500).json({ error: 'Failed to list videos' });
    }
});
// API endpoint to get video formats
app.get('/api/video/:baseFilename/formats', (req, res) => {
    const baseFilename = req.params.baseFilename;
    const formats = getAvailableFormats(baseFilename);
    res.json(formats);
});
// API endpoint to download specific format
app.get('/api/video/:baseFilename/:filename', (req, res) => {
    const { baseFilename, filename } = req.params;
    const filePath = path.join(formatsDir, baseFilename, filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    }
    else {
        res.status(404).json({ error: 'Video format not found' });
    }
});
// API endpoint to serve HLS streams
app.get('/api/hls/:baseFilename/:filename', (req, res) => {
    const { baseFilename, filename } = req.params;
    const filePath = path.join(hlsDir, baseFilename, filename);
    if (fs.existsSync(filePath)) {
        if (filename.endsWith('.m3u8')) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        }
        else if (filename.endsWith('.ts')) {
            res.setHeader('Content-Type', 'video/mp2t');
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control');
        res.sendFile(filePath);
    }
    else {
        res.status(404).json({ error: 'HLS file not found' });
    }
});
// API endpoint to download original file
app.get('/api/videos/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    }
    else {
        res.status(404).json({ error: 'Video not found' });
    }
});
// API endpoint to check FFmpeg status
app.get('/api/ffmpeg/status', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const available = yield checkFFmpeg();
        res.json({ available, path: FFMPEG_PATH });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        res.json({ available: false, error: errorMessage });
    }
}));
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`FFmpeg path: ${FFMPEG_PATH}`);
});
exports.default = server;
