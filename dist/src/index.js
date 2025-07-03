"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ws_1 = require("ws");
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const app = (0, express_1.default)();
const PORT = 8000;
const videoDir = path_1.default.join(__dirname, '../videos/live');
if (!fs_1.default.existsSync(videoDir))
    fs_1.default.mkdirSync(videoDir, { recursive: true });
app.use('/hls', express_1.default.static(videoDir));
const server = app.listen(PORT, () => {
    console.log(`HTTP server running on http://localhost:${PORT}`);
});
const wss = new ws_1.WebSocketServer({ server });
wss.on('connection', (ws) => {
    console.log('Client connected');
    const ffmpeg = (0, child_process_1.spawn)(ffmpeg_static_1.default, [
        '-i', 'pipe:0',
        '-preset', 'veryfast',
        '-g', '30',
        '-sc_threshold', '0',
        '-map', '0:v:0', '-map', '0:a:0',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-b:v:0', '3000k',
        '-b:a', '128k',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '3',
        '-hls_flags', 'delete_segments+append_list+program_date_time',
        '-master_pl_name', 'stream.m3u8',
        '-hls_segment_filename', path_1.default.join(videoDir, 'chunk_%03d.ts'),
        path_1.default.join(videoDir, 'stream.m3u8')
    ]);
    ws.on('message', (msg) => {
        ffmpeg.stdin.write(msg);
    });
    ws.on('close', () => {
        ffmpeg.stdin.end();
        ffmpeg.kill('SIGINT');
        console.log('Client disconnected, FFmpeg stopped.');
    });
    ffmpeg.stderr.on('data', (data) => console.error('FFmpeg:', data.toString()));
});
