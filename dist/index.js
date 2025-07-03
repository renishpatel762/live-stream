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
// Store for active live streams
const liveStreams = new Map();
// Store for connected clients
const clients = new Map();
// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const liveHlsDir = path.join(__dirname, 'live-hls');
const formatsDir = path.join(__dirname, 'formats');
[uploadsDir, liveHlsDir, formatsDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});
// HLS configuration
const HLS_CONFIG = {
    segmentDuration: 6, // seconds
    maxSegments: 10, // keep last 10 segments
    targetLatency: 18 // 3 segments * 6 seconds
};
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
// Create live HLS stream
function createLiveHLSStream(streamId, streamName) {
    return new Promise((resolve, reject) => {
        const hlsDir = path.join(liveHlsDir, streamId);
        // Clean up existing directory
        if (fs.existsSync(hlsDir)) {
            fs.rmSync(hlsDir, { recursive: true, force: true });
        }
        fs.mkdirSync(hlsDir, { recursive: true });
        const stream = liveStreams.get(streamId);
        if (!stream) {
            reject(new Error('Stream not found'));
            return;
        }
        // FFmpeg arguments for live HLS transcoding
        const ffmpegArgs = [
            '-f', 'webm',
            '-i', 'pipe:0', // Read from stdin
            // Video encoding settings
            '-c:v', 'libx264',
            '-preset', 'veryfast', // Fast encoding for real-time
            '-tune', 'zerolatency', // Minimize latency
            '-profile:v', 'baseline',
            '-level', '3.0',
            // Multiple quality outputs
            '-map', '0:v', '-map', '0:a',
            '-map', '0:v', '-map', '0:a',
            '-map', '0:v', '-map', '0:a',
            // 720p output
            '-s:v:0', '1280x720',
            '-b:v:0', '2500k',
            '-maxrate:v:0', '2750k',
            '-bufsize:v:0', '5000k',
            '-b:a:0', '128k',
            // 480p output
            '-s:v:1', '854x480',
            '-b:v:1', '1000k',
            '-maxrate:v:1', '1100k',
            '-bufsize:v:1', '2000k',
            '-b:a:1', '96k',
            // 360p output
            '-s:v:2', '640x360',
            '-b:v:2', '500k',
            '-maxrate:v:2', '550k',
            '-bufsize:v:2', '1000k',
            '-b:a:2', '64k',
            // HLS output settings
            '-f', 'hls',
            '-hls_time', HLS_CONFIG.segmentDuration.toString(),
            '-hls_list_size', HLS_CONFIG.maxSegments.toString(),
            '-hls_flags', 'delete_segments+independent_segments',
            '-hls_segment_type', 'mpegts',
            '-hls_segment_filename', path.join(hlsDir, 'segment_%v_%03d.ts'),
            // Master playlist with variant streams
            '-master_pl_name', 'master.m3u8',
            '-var_stream_map', 'v:0,a:0 v:1,a:1 v:2,a:2',
            path.join(hlsDir, 'stream_%v.m3u8')
        ];
        console.log(`Starting FFmpeg process for stream ${streamId}`);
        const ffmpegProcess = (0, child_process_1.spawn)(FFMPEG_PATH, ffmpegArgs);
        stream.ffmpegProcess = ffmpegProcess;
        stream.hlsDir = hlsDir;
        stream.inputPipe = ffmpegProcess.stdin;
        ffmpegProcess.stdout.on('data', (data) => {
            console.log(`FFmpeg stdout: ${data}`);
        });
        ffmpegProcess.stderr.on('data', (data) => {
            const output = data.toString();
            console.log(`FFmpeg stderr: ${output}`);
            // Check if HLS is generating segments
            if (output.includes('Opening') && output.includes('.ts')) {
                if (stream.status === 'starting') {
                    stream.status = 'live';
                    console.log(`Stream ${streamId} is now live`);
                    // Notify all viewers
                    notifyViewers(streamId, {
                        type: 'stream-live',
                        streamId: streamId,
                        streamName: streamName,
                        hlsUrl: `/api/live-hls/${streamId}/master.m3u8`
                    });
                }
            }
        });
        ffmpegProcess.on('close', (code) => {
            console.log(`FFmpeg process closed with code ${code}`);
            stream.status = 'stopped';
            stream.ffmpegProcess = null;
            // Notify viewers that stream ended
            notifyViewers(streamId, {
                type: 'stream-ended',
                streamId: streamId
            });
        });
        ffmpegProcess.on('error', (error) => {
            console.error('FFmpeg error:', error);
            stream.status = 'stopped';
            reject(error);
        });
        // Wait a bit for FFmpeg to initialize
        setTimeout(() => {
            resolve();
        }, 2000);
    });
}
// Notify all viewers of a stream
function notifyViewers(streamId, message) {
    const stream = liveStreams.get(streamId);
    if (stream) {
        stream.viewers.forEach(clientId => {
            const client = clients.get(clientId);
            if (client && client.ws.readyState === 1) {
                client.ws.send(JSON.stringify(message));
            }
        });
    }
}
// Broadcast message to all connected clients
function broadcastToAll(message) {
    clients.forEach(client => {
        if (client.ws.readyState === 1) {
            client.ws.send(JSON.stringify(message));
        }
    });
}
// Get list of active streams
function getActiveStreams() {
    const streams = [];
    liveStreams.forEach((stream, streamId) => {
        streams.push({
            id: streamId,
            name: stream.name,
            status: stream.status,
            viewers: stream.viewers.size,
            startTime: stream.startTime,
            uptime: Date.now() - stream.startTime
        });
    });
    return streams;
}
// WebSocket connection handler
wss.on('connection', (ws) => {
    const clientId = (0, uuid_1.v4)();
    console.log(`Client connected: ${clientId}`);
    clients.set(clientId, {
        ws: ws,
        currentStream: null,
        isStreamer: false
    });
    // Send current active streams to new client
    ws.send(JSON.stringify({
        type: 'active-streams',
        streams: getActiveStreams()
    }));
    ws.on('message', (data) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            const message = JSON.parse(data.toString());
            const client = clients.get(clientId);
            if (!client)
                return;
            switch (message.type) {
                case 'start-live-stream':
                    const streamId = (0, uuid_1.v4)();
                    const streamName = message.streamName || `Stream ${Date.now()}`;
                    // Create new live stream
                    liveStreams.set(streamId, {
                        id: streamId,
                        name: streamName,
                        ffmpegProcess: null,
                        startTime: Date.now(),
                        viewers: new Set(),
                        status: 'starting',
                        inputPipe: null,
                        hlsDir: '',
                        sequenceNumber: 0,
                        segments: [],
                        maxSegments: HLS_CONFIG.maxSegments
                    });
                    client.isStreamer = true;
                    client.currentStream = streamId;
                    try {
                        yield createLiveHLSStream(streamId, streamName);
                        ws.send(JSON.stringify({
                            type: 'stream-started',
                            streamId: streamId,
                            streamName: streamName
                        }));
                        // Broadcast new stream to all clients
                        broadcastToAll({
                            type: 'new-stream',
                            stream: {
                                id: streamId,
                                name: streamName,
                                status: 'starting',
                                viewers: 0,
                                startTime: Date.now()
                            }
                        });
                        console.log(`Live stream started: ${streamId} - ${streamName}`);
                    }
                    catch (error) {
                        console.error('Failed to create live stream:', error);
                        liveStreams.delete(streamId);
                        ws.send(JSON.stringify({
                            type: 'stream-error',
                            error: 'Failed to start live stream'
                        }));
                    }
                    break;
                case 'live-video-chunk':
                    if (client.currentStream && client.isStreamer) {
                        const stream = liveStreams.get(client.currentStream);
                        if (stream && stream.inputPipe && stream.status !== 'stopped') {
                            try {
                                const chunk = Buffer.from(message.data, 'base64');
                                stream.inputPipe.write(chunk);
                            }
                            catch (error) {
                                console.error('Error writing to FFmpeg pipe:', error);
                            }
                        }
                    }
                    break;
                case 'stop-live-stream':
                    if (client.currentStream && client.isStreamer) {
                        const stream = liveStreams.get(client.currentStream);
                        if (stream) {
                            stream.status = 'stopping';
                            // Close FFmpeg input
                            if (stream.inputPipe) {
                                stream.inputPipe.end();
                            }
                            // Kill FFmpeg process
                            if (stream.ffmpegProcess) {
                                stream.ffmpegProcess.kill('SIGTERM');
                            }
                            // Clean up after a delay
                            setTimeout(() => {
                                liveStreams.delete(client.currentStream);
                                // Clean up HLS files
                                if (stream.hlsDir && fs.existsSync(stream.hlsDir)) {
                                    fs.rmSync(stream.hlsDir, { recursive: true, force: true });
                                }
                            }, 5000);
                            ws.send(JSON.stringify({
                                type: 'stream-stopped',
                                streamId: client.currentStream
                            }));
                            // Broadcast stream ended
                            broadcastToAll({
                                type: 'stream-ended',
                                streamId: client.currentStream
                            });
                            client.currentStream = null;
                            client.isStreamer = false;
                        }
                    }
                    break;
                case 'join-stream':
                    const joinStreamId = message.streamId;
                    const stream = liveStreams.get(joinStreamId);
                    if (stream) {
                        // Remove from previous stream
                        if (client.currentStream) {
                            const prevStream = liveStreams.get(client.currentStream);
                            if (prevStream) {
                                prevStream.viewers.delete(clientId);
                            }
                        }
                        // Add to new stream
                        stream.viewers.add(clientId);
                        client.currentStream = joinStreamId;
                        ws.send(JSON.stringify({
                            type: 'joined-stream',
                            streamId: joinStreamId,
                            streamName: stream.name,
                            hlsUrl: `/api/live-hls/${joinStreamId}/master.m3u8`,
                            status: stream.status
                        }));
                        // Update viewer count
                        broadcastToAll({
                            type: 'viewer-count-update',
                            streamId: joinStreamId,
                            viewers: stream.viewers.size
                        });
                        console.log(`Client ${clientId} joined stream ${joinStreamId}`);
                    }
                    else {
                        ws.send(JSON.stringify({
                            type: 'stream-not-found',
                            streamId: joinStreamId
                        }));
                    }
                    break;
                case 'leave-stream':
                    if (client.currentStream) {
                        const stream = liveStreams.get(client.currentStream);
                        if (stream) {
                            stream.viewers.delete(clientId);
                            // Update viewer count
                            broadcastToAll({
                                type: 'viewer-count-update',
                                streamId: client.currentStream,
                                viewers: stream.viewers.size
                            });
                        }
                        client.currentStream = null;
                        ws.send(JSON.stringify({
                            type: 'left-stream'
                        }));
                    }
                    break;
                case 'get-active-streams':
                    ws.send(JSON.stringify({
                        type: 'active-streams',
                        streams: getActiveStreams()
                    }));
                    break;
                default:
                    console.log('Unknown message type:', message.type);
            }
        }
        catch (error) {
            console.error('Error processing message:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: 'Error processing message'
            }));
        }
    }));
    ws.on('close', () => {
        console.log(`Client disconnected: ${clientId}`);
        const client = clients.get(clientId);
        if (client) {
            // If client was streaming, stop the stream
            if (client.isStreamer && client.currentStream) {
                const stream = liveStreams.get(client.currentStream);
                if (stream) {
                    stream.status = 'stopping';
                    if (stream.inputPipe) {
                        stream.inputPipe.end();
                    }
                    if (stream.ffmpegProcess) {
                        stream.ffmpegProcess.kill('SIGTERM');
                    }
                    // Clean up
                    setTimeout(() => {
                        liveStreams.delete(client.currentStream);
                        if (stream.hlsDir && fs.existsSync(stream.hlsDir)) {
                            fs.rmSync(stream.hlsDir, { recursive: true, force: true });
                        }
                    }, 5000);
                    broadcastToAll({
                        type: 'stream-ended',
                        streamId: client.currentStream
                    });
                }
            }
            // Remove from stream viewers
            if (client.currentStream) {
                const stream = liveStreams.get(client.currentStream);
                if (stream) {
                    stream.viewers.delete(clientId);
                    broadcastToAll({
                        type: 'viewer-count-update',
                        streamId: client.currentStream,
                        viewers: stream.viewers.size
                    });
                }
            }
        }
        clients.delete(clientId);
    });
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});
// API endpoint to serve live HLS streams
app.get('/api/live-hls/:streamId/:filename', (req, res) => {
    const { streamId, filename } = req.params;
    const stream = liveStreams.get(streamId);
    if (!stream) {
        return res.status(404).json({ error: 'Stream not found' });
    }
    const filePath = path.join(stream.hlsDir, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    // Set appropriate headers
    if (filename.endsWith('.m3u8')) {
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    else if (filename.endsWith('.ts')) {
        res.setHeader('Content-Type', 'video/mp2t');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
    }
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control');
    res.sendFile(filePath);
});
// API endpoint to get active streams
app.get('/api/live-streams', (req, res) => {
    res.json({
        streams: getActiveStreams()
    });
});
// API endpoint to get stream info
app.get('/api/live-streams/:streamId', (req, res) => {
    const streamId = req.params.streamId;
    const stream = liveStreams.get(streamId);
    if (!stream) {
        return res.status(404).json({ error: 'Stream not found' });
    }
    res.json({
        id: stream.id,
        name: stream.name,
        status: stream.status,
        viewers: stream.viewers.size,
        startTime: stream.startTime,
        uptime: Date.now() - stream.startTime,
        hlsUrl: `/api/live-hls/${streamId}/master.m3u8`
    });
});
// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        activeStreams: liveStreams.size,
        connectedClients: clients.size,
        timestamp: new Date().toISOString()
    });
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
// Cleanup function
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    // Stop all active streams
    liveStreams.forEach((stream) => {
        if (stream.ffmpegProcess) {
            stream.ffmpegProcess.kill('SIGTERM');
        }
    });
    // Clean up HLS directories
    if (fs.existsSync(liveHlsDir)) {
        fs.rmSync(liveHlsDir, { recursive: true, force: true });
    }
    process.exit(0);
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`FFmpeg path: ${FFMPEG_PATH}`);
    console.log('Real-time HLS streaming server ready');
});
exports.default = server;
