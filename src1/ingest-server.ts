// ingest-server.ts
import WebSocket from 'ws';
import { spawn } from 'child_process';

const wss = new WebSocket.Server({ port: 9090 });

wss.on('connection', (ws) => {
  console.log('📡 Browser connected via WebSocket');

  const ffmpeg = spawn('ffmpeg', [
    // input is WebM fragments
    '-f', 'webm',
    '-i', 'pipe:0',

    // ─── VIDEO ───
    // transcode VP8 → H.264 for FLV/RTMP
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'baseline',
    '-pix_fmt', 'yuv420p',
    '-b:v', '1500k',

    // ─── AUDIO ───
    // transcode Opus → AAC
    '-c:a', 'aac',
    '-ar', '48000',
    '-b:a', '128k',

    // ─── OUTPUT ───
    '-f', 'flv',
    'rtmp://localhost:1935/live/stream',
  ]);

  ffmpeg.stderr.on('data', (data) => {
    console.error(`FFmpeg stderr: ${data}`);
  });

  ffmpeg.on('exit', (code, signal) => {
    console.log(`FFmpeg exited with ${code} (${signal})`);
  });

  ws.on('message', (data) => {
    if (ffmpeg.stdin.writable) {
      ffmpeg.stdin.write(data);
    }
  });

  ws.on('close', () => {
    console.log('❌ WebSocket disconnected');
    ffmpeg.stdin.end();
    ffmpeg.kill('SIGINT');
  });
});

console.log('🧲 Ingest server running on ws://localhost:9090');
