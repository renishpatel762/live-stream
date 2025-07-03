// server.ts
import NodeMediaServer from 'node-media-server';
import config from './config';
import fs from 'fs';
import path from 'path';

const nms = new NodeMediaServer(config as any);

// Enhanced event handling with debugging
nms.on('preConnect', (id, args) => {
  console.log('[NMS] preConnect:', id, args);
});

nms.on('postConnect', (id, args) => {
  console.log('[NMS] postConnect:', id, args);
});

nms.on('doneConnect', (id, args) => {
  console.log('[NMS] doneConnect:', id, args);
});

nms.on('prePublish', (id, StreamPath, args) => {
  console.log('[NMS] prePublish:', id, StreamPath, args);
  
  // Log stream details
  const session:any = nms.getSession(id);
  if (session) {
    console.log('[DEBUG] Publisher session details:', {
      id: session.id,
      ip: session.ip,
      streamPath: session.streamPath,
      videoCodec: session.videoCodec,
      audioCodec: session.audioCodec,
      videoWidth: session.videoWidth,
      videoHeight: session.videoHeight,
      videoFramerate: session.videoFramerate
    });
  }
});

nms.on('postPublish', (id, StreamPath, args) => {
   // guard against undefined, just in case
   if (typeof StreamPath !== 'string') {
    console.error('[NMS] postPublish called without a StreamPath!', args);
    return;
  }
  
  console.log('[NMS] postPublish:', id, StreamPath, args);
  
  // Check if transcoding directories exist
  const streamName:any = StreamPath.split('/').pop();
  const hlsPath = path.join(config.http.mediaroot, 'hls', streamName);
  
  // Create HLS directory for this stream if it doesn't exist
  if (!fs.existsSync(hlsPath)) {
    fs.mkdirSync(hlsPath, { recursive: true });
    console.log(`[DEBUG] Created HLS directory: ${hlsPath}`);
  }
  
  // Set up file system watcher to monitor HLS file creation
  if (fs.existsSync(hlsPath)) {
    const watcher = fs.watch(hlsPath, (eventType, filename) => {
      if (filename) {
        console.log(`[HLS] File ${eventType}: ${filename}`);
        if (filename.endsWith('.ts')) {
          console.log(`[HLS] ✓ Video segment created: ${filename}`);
        } else if (filename.endsWith('.m3u8')) {
          console.log(`[HLS] ✓ Playlist updated: ${filename}`);
        }
      }
    });
    
    // Clean up watcher when stream ends
    nms.on('donePublish', (doneId) => {
      if (doneId === id) {
        watcher.close();
        console.log(`[DEBUG] Closed file watcher for stream ${id}`);
      }
    });
  }
  
  // Monitor transcoding process
  setTimeout(() => {
    checkTranscodingStatus(streamName, hlsPath);
  }, 5000); // Check after 5 seconds
});

nms.on('donePublish', (id, StreamPath, args) => {
  console.log('[NMS] donePublish:', id, StreamPath, args);
});

// Add error handling
nms.on('error', (error) => {
  console.error('[NMS] Server error:', error);
});

// Function to check transcoding status
function checkTranscodingStatus(streamName: string, hlsPath: string) {
  console.log(`[DEBUG] Checking transcoding status for stream: ${streamName}`);
  
  if (!fs.existsSync(hlsPath)) {
    console.error(`[ERROR] HLS directory doesn't exist: ${hlsPath}`);
    return;
  }
  
  const files = fs.readdirSync(hlsPath);
  console.log(`[DEBUG] Files in HLS directory:`, files);
  
  const hasPlaylist = files.some(f => f.endsWith('.m3u8'));
  const hasSegments = files.some(f => f.endsWith('.ts'));
  
  if (!hasPlaylist && !hasSegments) {
    console.error(`[ERROR] No HLS files generated. Possible issues:`);
    console.error(`  1. FFmpeg not found or not working`);
    console.error(`  2. Input stream format not supported`);
    console.error(`  3. Transcoding configuration error`);
    console.error(`  4. Insufficient permissions`);
    
    // Check if master playlist exists
    const masterPlaylist = path.join(config.http.mediaroot, 'hls', 'master.m3u8');
    if (!fs.existsSync(masterPlaylist)) {
      console.error(`  5. Master playlist not created: ${masterPlaylist}`);
    }
  } else {
    console.log(`[SUCCESS] HLS files generated successfully`);
    console.log(`  - Playlists: ${files.filter(f => f.endsWith('.m3u8')).length}`);
    console.log(`  - Segments: ${files.filter(f => f.endsWith('.ts')).length}`);
  }
}

// Test FFmpeg availability
function testFFmpeg() {
  const { spawn } = require('child_process');
  const ffmpegPath = config.trans.ffmpeg;
  
  console.log(`[DEBUG] Testing FFmpeg at: ${ffmpegPath}`);
  
  const ffmpeg = spawn(ffmpegPath, ['-version'], { stdio: 'pipe' });
  
  ffmpeg.stdout.on('data', (data: Buffer) => {
    const output = data.toString();
    if (output.includes('ffmpeg version')) {
      console.log('[SUCCESS] FFmpeg is working correctly');
      const versionMatch = output.match(/ffmpeg version ([^\s]+)/);
      if (versionMatch) {
        console.log(`[INFO] FFmpeg version: ${versionMatch[1]}`);
      }
    }
  });
  
  ffmpeg.on('error', (error: Error) => {
    console.error(`[ERROR] FFmpeg test failed:`, error.message);
    console.error(`Make sure FFmpeg is installed and the path is correct: ${ffmpegPath}`);
  });
  
  ffmpeg.on('close', (code: number) => {
    if (code !== 0) {
      console.error(`[ERROR] FFmpeg test exited with code ${code}`);
    }
  });
}

// Start server with enhanced logging
console.log('🚀 Starting Node Media Server...');
console.log('📁 Media root:', config.http.mediaroot);
console.log('⚙️ Config:', JSON.stringify(config, null, 2));

// Test FFmpeg before starting
testFFmpeg();

nms.run();

console.log('▶️ NMS running:');
console.log('  RTMP: rtmp://localhost:1935/live/stream');
console.log('  HLS:  http://localhost:8000/hls/master.m3u8');
console.log('  Admin: http://localhost:8000/admin');
console.log('');
console.log('📊 Debug URLs:');
console.log('  Stream info: http://localhost:8000/api/streams');
console.log('  Server stats: http://localhost:8000/api/server');

// Add graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  nms.stop();
  process.exit(0);
});

// // server.ts
// import NodeMediaServer from 'node-media-server';
// import config from './config';

// const nms = new NodeMediaServer(config as any);
// nms.on('prePublish', (id, StreamPath, args) => {
//   console.log('[NMS] prePublish:', id, StreamPath, args);
// });
// nms.on('postPublish', (id, StreamPath, args) => {
//   console.log('[NMS] postPublish:', id, StreamPath, args);
// });
// nms.on('donePublish', (id, StreamPath, args) => {
//   console.log('[NMS] donePublish:', id, StreamPath, args);
// });
// nms.run();

// console.log('▶️ NMS running:');
// console.log('  RTMP: rtmp://localhost:1935/live/stream');
// console.log('  HLS:  http://localhost:8000/hls/master.m3u8');
