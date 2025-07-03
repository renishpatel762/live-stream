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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ws_1 = require("ws");
const http_1 = require("http");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const wss = new ws_1.WebSocketServer({ server });
// Serve static files
app.use(express_1.default.static('public'));
// Store for active video recordings
const recordings = new Map();
// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
wss.on('connection', (ws) => {
    console.log('Client connected');
    let recordingId = null;
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            switch (message.type) {
                case 'start-recording':
                    recordingId = `${Date.now()}`;
                    const filename = `video_${Date.now()}.webm`;
                    recordings.set(recordingId, {
                        chunks: [],
                        startTime: Date.now(),
                        filename
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
                        const videoBuffer = Buffer.concat(recording.chunks);
                        const filePath = path.join(uploadsDir, recording.filename);
                        fs.writeFileSync(filePath, videoBuffer);
                        const duration = Date.now() - recording.startTime;
                        const fileSize = videoBuffer.length;
                        recordings.delete(recordingId);
                        ws.send(JSON.stringify({
                            type: 'recording-saved',
                            filename: recording.filename,
                            duration: duration,
                            fileSize: fileSize,
                            path: filePath
                        }));
                        console.log(`Saved recording: ${recording.filename} (${fileSize} bytes, ${duration}ms)`);
                        recordingId = null;
                    }
                    break;
                default:
                    console.log('Unknown message type:', message.type);
            }
        }
        catch (error) {
            console.error('Error processing message:', error);
        }
    });
    ws.on('close', () => {
        console.log('Client disconnected');
        // Clean up any ongoing recording
        if (recordingId && recordings.has(recordingId)) {
            recordings.delete(recordingId);
        }
    });
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});
// API endpoint to list recorded videos
app.get('/api/videos', (req, res) => {
    try {
        const files = fs.readdirSync(uploadsDir)
            .filter(file => file.endsWith('.webm'))
            .map(file => {
            const stats = fs.statSync(path.join(uploadsDir, file));
            return {
                filename: file,
                size: stats.size,
                created: stats.birthtime
            };
        });
        res.json(files);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to list videos' });
    }
});
// API endpoint to download videos
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
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
exports.default = server;
