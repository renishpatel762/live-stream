"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startTranscoding = startTranscoding;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const videoDir = path_1.default.join(__dirname, '../videos/live');
if (!fs_1.default.existsSync(videoDir))
    fs_1.default.mkdirSync(videoDir, { recursive: true });
function startTranscoding(inputStream) {
    const ffmpeg = (0, child_process_1.spawn)('ffmpeg', [
        '-i', 'pipe:0',
        '-c:v', 'libx264',
        '-c:a', 'aac',
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '5',
        '-hls_flags', 'delete_segments',
        path_1.default.join(videoDir, 'stream.m3u8')
    ]);
    inputStream.pipe(ffmpeg.stdin);
    ffmpeg.stderr.on('data', (data) => {
        console.log('FFmpeg:', data.toString());
    });
    ffmpeg.on('close', (code) => {
        console.log(`FFmpeg process exited with code ${code}`);
    });
    inputStream.on('end', () => {
        console.log('Input stream ended');
        ffmpeg.stdin.end();
    });
    inputStream.on('close', () => {
        console.log('Input stream closed');
        ffmpeg.stdin.end();
    });
    inputStream.on('error', (err) => {
        console.error('Input stream error:', err);
        ffmpeg.stdin.destroy();
    });
    ffmpeg.stdin.on('error', (err) => {
        console.error('FFmpeg stdin error:', err);
    });
    return ffmpeg;
}
