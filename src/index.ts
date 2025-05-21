import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';
import http from 'http';

const app: express.Application = express();
const PORT: number = 8000;
const videoDir: string = path.join(__dirname, '../videos/live');

// Ensure video directory exists
if (!fs.existsSync(videoDir)) {
  fs.mkdirSync(videoDir, { recursive: true });
}

// Serve HLS video files and static client files
app.use('/hls', express.static(videoDir));
// app.use('/', express.static(path.join(__dirname, '../client')));

// Start the HTTP server
const server: http.Server = app.listen(PORT, () => {
  console.log(`HTTP server running on http://localhost:${PORT}`);
});

// Create WebSocket server
const wss: WebSocketServer = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  console.log('Client connected');
  let ffmpegProcess: ChildProcess | null = null;
  let stdinClosed: boolean = false;

  try {
    const ffmpegArgs = [
      // — increase input queues —
      '-thread_queue_size', '512',
      '-thread_queue_size', '512',

      // — declare input & timestamp handling —
      '-f', 'webm',
      '-fflags', 'nobuffer+discardcorrupt+genpts',
      '-use_wallclock_as_timestamps', '1',
      '-avoid_negative_ts', 'make_zero',

      // — force audio PTS regen & VFR sync —
      '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
      '-vsync', '1',

      // — input pipe —
      '-i', 'pipe:0',

      // — video encoding —
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-g', '30',
      '-sc_threshold', '0',
      '-b:v', '3000k',

      // — audio encoding (after filter) —
      '-c:a', 'aac',
      '-b:a', '128k',

      // — HLS muxer —
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '3',
      '-hls_flags', 'delete_segments+append_list+program_date_time',
      '-master_pl_name', 'stream.m3u8',
      '-hls_segment_filename', path.join(videoDir, 'chunk_%03d.ts'),

      // — output playlist —
      path.join(videoDir, 'stream.m3u8')
    ];
    
    ffmpegProcess = spawn(ffmpegPath as string, ffmpegArgs);
    // ffmpegProcess = spawn(ffmpegPath as string, [
    // // 1) Declare that the incoming stream is WebM
    //  '-f', 'webm',
    //   '-preset', 'veryfast',
    //   '-g', '30',
    //   '-sc_threshold', '0',
    //   '-map', '0:v:0', '-map', '0:a:0',
    //   '-c:v', 'libx264',
    //   '-c:a', 'aac',
    //   '-b:v:0', '3000k',
    //   '-b:a', '128k',
    //   '-f', 'hls',
    //   '-hls_time', '2',
    //   '-hls_list_size', '3',
    //   '-hls_flags', 'delete_segments+append_list+program_date_time',
    //   '-master_pl_name', 'stream.m3u8',
    //   '-hls_segment_filename', path.join(videoDir, 'chunk_%03d.ts'),
    //   path.join(videoDir, 'stream.m3u8')
    // ]);

    // Ensure stdin exists
    if (!ffmpegProcess.stdin) {
      console.error('FFmpeg process has no stdin');
      return;
    }

    // Handle FFmpeg process errors
    ffmpegProcess.on('error', (err: Error) => {
      console.error('FFmpeg process error:', err);
    });

    // Handle FFmpeg stdout (not typically used for FFmpeg)
    if (ffmpegProcess.stdout) {
      ffmpegProcess.stdout.on('data', (data: Buffer) => {
        // Handle FFmpeg stdout if needed
      });
    }

    // Handle FFmpeg stderr (where FFmpeg logs appear)
    if (ffmpegProcess.stderr) {
      ffmpegProcess.stderr.on('data', (data: Buffer) => {
        console.error('FFmpeg:', data.toString());
      });
    }

    // Handle FFmpeg process exit
    ffmpegProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (code !== null) {
        console.log(`FFmpeg process exited with code ${code}`);
      } else if (signal) {
        console.log(`FFmpeg process killed with signal ${signal}`);
      }
    });

    // Handle stdin errors
    ffmpegProcess.stdin.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EPIPE' || err.code === 'EOF') {
        console.log('FFmpeg stdin has been closed');
      } else {
        console.error('FFmpeg stdin error:', err);
      }
    });

    // Handle incoming WebSocket messages
    ws.on('message', (msg: Buffer) => {
      if (ffmpegProcess && ffmpegProcess.stdin && ffmpegProcess.stdin.writable && !stdinClosed) {
        try {
          // Write the data to FFmpeg's stdin
          const writeResult: boolean = ffmpegProcess.stdin.write(msg);
          
          // If the buffer is full, wait for drain before writing more
          if (!writeResult) {
            ffmpegProcess.stdin.once('drain', () => {
              // The buffer is empty again, can continue writing
            });
          }
        } catch (err) {
          console.error('Error writing to FFmpeg stdin:', err);
        }
      }
    });

    // Handle WebSocket close
    ws.on('close', () => {
      // Mark stdin as closed to prevent further writes
      stdinClosed = true;
      
      // Close FFmpeg stdin stream gracefully
      if (ffmpegProcess && ffmpegProcess.stdin) {
        try {
          ffmpegProcess.stdin.end();
        } catch (err) {
          console.error('Error closing FFmpeg stdin:', err);
        }
      }
      
      // Give FFmpeg a moment to finish processing, then kill the process
      setTimeout(() => {
        if (ffmpegProcess) {
          try {
            ffmpegProcess.kill('SIGTERM');
          } catch (err) {
            console.error('Error killing FFmpeg process:', err);
          }
        }
      }, 500);
      
      console.log('Client disconnected, FFmpeg stopped.');
    });

    // Handle WebSocket errors
    ws.on('error', (err: Error) => {
      console.error('WebSocket error:', err);
    });
  } catch (err) {
    console.error('Error setting up FFmpeg process:', err);
  }
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  server.close(() => {
    console.log('Server shut down.');
    process.exit(0);
  });
});

process.on('uncaughtException', (err: Error) => {
  console.error('Uncaught exception:', err);
  // Keep the server running despite uncaught exceptions
});
