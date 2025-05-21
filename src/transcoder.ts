import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const videoDir = path.join(__dirname, '../videos/live');
if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

export function startTranscoding(inputStream: NodeJS.ReadableStream) {
  const ffmpeg = spawn('ffmpeg', [
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '5',
    '-hls_flags', 'delete_segments',
    path.join(videoDir, 'stream.m3u8')
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
