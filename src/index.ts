import express, { Request, Response } from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// FFmpeg path
const FFMPEG_PATH = 'C:/ffmpeg/bin/ffmpeg.exe';

// Serve static files
app.use(express.static('public'));

// Store for active live streams
const liveStreams = new Map<string, {
  id: string;
  name: string;
  ffmpegProcess: ChildProcess | null;
  startTime: number;
  endTime: number | null;
  viewers: Set<string>;
  status: 'starting' | 'live' | 'stopping' | 'stopped' | 'archived';
  inputPipe: any;
  hlsDir: string;
  sequenceNumber: number;
  segments: string[];
  maxSegments: number;
  qualities: string[];
  preserveAfterStop: boolean;
}>();

// Store for connected clients
const clients = new Map<string, {
  ws: any;
  currentStream: string | null;
  isStreamer: boolean;
  selectedQuality: string;
}>();

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const liveHlsDir = path.join(__dirname, 'live-hls');
const archivedHlsDir = path.join(__dirname, 'archived-hls');
const formatsDir = path.join(__dirname, 'formats');

[uploadsDir, liveHlsDir, archivedHlsDir, formatsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// HLS configuration
const HLS_CONFIG = {
  segmentDuration: 2, // seconds
  maxSegments: 3, // keep last 10 segments during live streaming
  targetLatency: 6, // 3 segments * 6 seconds
  qualities: [
    // { name: '720p', width: 1280, height: 720, bitrate: 2500, audioBitrate: 128 },
    // { name: '480p', width: 854, height: 480, bitrate: 1000, audioBitrate: 96 },
    { name: '360p', width: 640, height: 360, bitrate: 500, audioBitrate: 64 }
  ]
};

// Check if FFmpeg is available
function checkFFmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const ffmpeg = spawn(FFMPEG_PATH, ['-version']);
    ffmpeg.on('close', (code) => {
      resolve(code === 0);
    });
    ffmpeg.on('error', () => {
      resolve(false);
    });
  });
}

// Create live HLS stream
function createLiveHLSStream(streamId: string, streamName: string): Promise<void> {
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

    // FFmpeg arguments for live HLS transcoding with multiple qualities
    const ffmpegArgs = [
      '-f', 'webm',
      '-i', 'pipe:0', // Read from stdin

      // Input buffer settings for lower latency
    '-fflags', '+genpts+nobuffer',
    '-flags', '+low_delay',
    '-avoid_negative_ts', 'make_zero',
    
      // Video encoding settings
      '-c:v', 'libx264',
      '-preset', 'ultrafast', // Fast encoding for real-time
      '-tune', 'zerolatency', // Minimize latency
      '-profile:v', 'baseline',
      '-level', '3.0',
      '-x264opts', 'keyint=60:min-keyint=60:scenecut=-1',
      
      // Audio encoding
      '-c:a', 'aac',
      '-ac', '2',
      
      // // Create multiple quality outputs
      // '-map', '0:v', '-map', '0:a', // 720p
      // '-map', '0:v', '-map', '0:a', // 480p
      '-map', '0:v', '-map', '0:a', // 360p
      
      // // 720p settings
      // '-s:v:0', '1280x720',
      // '-b:v:0', '2500k',
      // '-maxrate:v:0', '2750k',
      // '-bufsize:v:0', '5000k',
      // '-b:a:0', '128k',
      
      // // 480p settings
      // '-s:v:1', '854x480',
      // '-b:v:1', '1000k',
      // '-maxrate:v:1', '1100k',
      // '-bufsize:v:1', '2000k',
      // '-b:a:1', '96k',
      
      // 360p settings
      '-s:v:2', '640x360',
      '-b:v:2', '500k',
      '-maxrate:v:2', '550k',
      '-bufsize:v:2', '64k',
      '-b:a:2', '64k',
      
      // HLS output settings
      '-f', 'hls',
      '-hls_time', HLS_CONFIG.segmentDuration.toString(),
      '-hls_list_size', HLS_CONFIG.maxSegments.toString(),
      '-hls_flags', 'delete_segments+independent_segments',
      '-hls_segment_type', 'mpegts',
      '-hls_delete_threshold', '1',
      
      // Segment naming
      '-hls_segment_filename', path.join(hlsDir, '%v_segment_%03d.ts'),
      
      // Master playlist
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', 'v:0,a:0,name:360p',
      // '-var_stream_map', 'v:0,a:0,name:720p v:1,a:1,name:480p v:2,a:2,name:360p',
      
      path.join(hlsDir, '%v.m3u8')
    ];

    console.log(`Starting FFmpeg process for stream ${streamId}`);
    const ffmpegProcess = spawn(FFMPEG_PATH, ffmpegArgs);
    
    stream.ffmpegProcess = ffmpegProcess;
    stream.hlsDir = hlsDir;
    stream.inputPipe = ffmpegProcess.stdin;
    stream.qualities = ['720p', '480p', '360p'];

    ffmpegProcess.stdout.on('data', (data) => {
      console.log(`FFmpeg stdout: ${data}`);
    });

    // ffmpegProcess.stderr.on('data', (data) => {
    ffmpegProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.log('FFmpeg stderr:', output);
      
      // Look for first segment creation
      if (output.includes('Opening') && output.includes('_segment_000.ts')) {
        console.log('First segment created!');
        if (stream.status === 'starting') {
          stream.status = 'live';
          console.log('Stream ${streamId} is now live');
          
          // Notify viewers immediately
          notifyViewers(streamId, {
            type: 'stream-live',
            streamId: streamId,
            streamName: streamName,
            hlsUrl: '/api/live-hls/${streamId}/master.m3u8',
            qualities: stream.qualities
          });
        }
      }
    });
    
    //   const output = data.toString();
    //   console.log(`FFmpeg stderr: ${output}`);
      
    //   // Check if HLS is generating segments
    //   if (output.includes('Opening') && output.includes('.ts')) {
    //     if (stream.status === 'starting') {
    //       stream.status = 'live';
    //       console.log(`Stream ${streamId} is now live`);
          
    //       // Notify all viewers
    //       notifyViewers(streamId, {
    //         type: 'stream-live',
    //         streamId: streamId,
    //         streamName: streamName,
    //         hlsUrl: `/api/live-hls/${streamId}/master.m3u8`,
    //         qualities: stream.qualities
    //       });
    //     }
    //   }
    // });

    ffmpegProcess.on('close', (code) => {
      console.log(`FFmpeg process closed with code ${code}`);
      
      if (stream.preserveAfterStop) {
        // Archive the stream
        archiveStream(streamId);
      } else {
        stream.status = 'stopped';
        // Clean up HLS files if not preserving
        if (fs.existsSync(hlsDir)) {
          fs.rmSync(hlsDir, { recursive: true, force: true });
        }
      }
      
      stream.ffmpegProcess = null;
      stream.endTime = Date.now();
      
      // Notify viewers that stream ended
      notifyViewers(streamId, {
        type: 'stream-ended',
        streamId: streamId,
        archived: stream.preserveAfterStop
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

// Archive stream after it stops
function archiveStream(streamId: string) {
  const stream = liveStreams.get(streamId);
  if (!stream) return;

  const sourceDir = stream.hlsDir;
  const archiveDir = path.join(archivedHlsDir, streamId);

  try {
    // Create archive directory
    if (!fs.existsSync(archiveDir)) {
      fs.mkdirSync(archiveDir, { recursive: true });
    }

    // Copy all files to archive directory
    const files = fs.readdirSync(sourceDir);
    files.forEach(file => {
      const sourcePath = path.join(sourceDir, file);
      const destPath = path.join(archiveDir, file);
      fs.copyFileSync(sourcePath, destPath);
    });

    // Update stream status
    stream.status = 'archived';
    stream.hlsDir = archiveDir;

    // Create a final master playlist without the delete_segments flag
    createArchiveMasterPlaylist(streamId, archiveDir);

    console.log(`Stream ${streamId} archived successfully`);
  } catch (error) {
    console.error(`Error archiving stream ${streamId}:`, error);
  }
}

// Create master playlist for archived content
function createArchiveMasterPlaylist(streamId: string, archiveDir: string) {
//   const masterPlaylistContent = `#EXTM3U
// #EXT-X-VERSION:6
// #EXT-X-STREAM-INF:BANDWIDTH=2628000,RESOLUTION=1280x720,NAME="720p"
// 720p.m3u8
// #EXT-X-STREAM-INF:BANDWIDTH=1096000,RESOLUTION=854x480,NAME="480p"
// 480p.m3u8
// #EXT-X-STREAM-INF:BANDWIDTH=564000,RESOLUTION=640x360,NAME="360p"
// 360p.m3u8
// `;

//   const masterPlaylistPath = path.join(archiveDir, 'master.m3u8');
//   fs.writeFileSync(masterPlaylistPath, masterPlaylistContent);
  const masterPlaylistContent = `#EXTM3U
#EXT-X-VERSION:6
#EXT-X-STREAM-INF:BANDWIDTH=564000,RESOLUTION=640x360,NAME="360p"
360p.m3u8
`;

  const masterPlaylistPath = path.join(archiveDir, 'master.m3u8');
  fs.writeFileSync(masterPlaylistPath, masterPlaylistContent);
}

// Notify all viewers of a stream
function notifyViewers(streamId: string, message: any) {
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
function broadcastToAll(message: any) {
  clients.forEach(client => {
    if (client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(message));
    }
  });
}

// Get list of active and archived streams
function getActiveStreams() {
  const streams: any[] = [];
  liveStreams.forEach((stream, streamId) => {
    streams.push({
      id: streamId,
      name: stream.name,
      status: stream.status,
      viewers: stream.viewers.size,
      startTime: stream.startTime,
      endTime: stream.endTime,
      uptime: stream.endTime ? (stream.endTime - stream.startTime) : (Date.now() - stream.startTime),
      qualities: stream.qualities
    });
  });
  return streams;
}

// Get archived streams
function getArchivedStreams() {
  const archived: any[] = [];
  liveStreams.forEach((stream, streamId) => {
    if (stream.status === 'archived') {
      archived.push({
        id: streamId,
        name: stream.name,
        status: stream.status,
        startTime: stream.startTime,
        endTime: stream.endTime,
        duration: stream.endTime ? (stream.endTime - stream.startTime) : 0,
        qualities: stream.qualities
      });
    }
  });
  return archived;
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  const clientId = uuidv4();
  console.log(`Client connected: ${clientId}`);
  
  clients.set(clientId, {
    ws: ws,
    currentStream: null,
    isStreamer: false,
    selectedQuality: '720p'
  });

  // Send current active streams to new client
  ws.send(JSON.stringify({
    type: 'active-streams',
    streams: getActiveStreams()
  }));

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      const client = clients.get(clientId);
      
      if (!client) return;
      
      switch (message.type) {
        case 'start-live-stream':
          const streamId = uuidv4();
          const streamName = message.streamName || `Stream ${Date.now()}`;
          const preserveAfterStop = message.preserveAfterStop !== false; // Default to true
          
          // Create new live stream
          liveStreams.set(streamId, {
            id: streamId,
            name: streamName,
            ffmpegProcess: null,
            startTime: Date.now(),
            endTime: null,
            viewers: new Set(),
            status: 'starting',
            inputPipe: null,
            hlsDir: '',
            sequenceNumber: 0,
            segments: [],
            maxSegments: HLS_CONFIG.maxSegments,
            qualities: [],
            preserveAfterStop: preserveAfterStop
          });
          
          client.isStreamer = true;
          client.currentStream = streamId;
          
          try {
            await createLiveHLSStream(streamId, streamName);
            
            ws.send(JSON.stringify({
              type: 'stream-started',
              streamId: streamId,
              streamName: streamName,
              preserveAfterStop: preserveAfterStop
            }));
            
            // Broadcast new stream to all clients
            broadcastToAll({
              type: 'new-stream',
              stream: {
                id: streamId,
                name: streamName,
                status: 'starting',
                viewers: 0,
                startTime: Date.now(),
                qualities: HLS_CONFIG.qualities.map(q => q.name)
              }
            });
            
            console.log(`Live stream started: ${streamId} - ${streamName}`);
            
          } catch (error) {
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
              } catch (error) {
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
              stream.endTime = Date.now();
              
              // Close FFmpeg input
              if (stream.inputPipe) {
                stream.inputPipe.end();
              }
              
              // Kill FFmpeg process
              if (stream.ffmpegProcess) {
                stream.ffmpegProcess.kill('SIGTERM');
              }
              
              ws.send(JSON.stringify({
                type: 'stream-stopped',
                streamId: client.currentStream,
                archived: stream.preserveAfterStop
              }));
              
              // Broadcast stream ended
              broadcastToAll({
                type: 'stream-ended',
                streamId: client.currentStream,
                archived: stream.preserveAfterStop
              });
              
              client.currentStream = null;
              client.isStreamer = false;
            }
          }
          break;

        case 'join-stream':
          const joinStreamId = message.streamId;
          const quality = message.quality || '720p';
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
            client.selectedQuality = quality;
            
            const hlsUrl = stream.status === 'archived' 
              ? `/api/archived-hls/${joinStreamId}/${quality}.m3u8`
              : `/api/live-hls/${joinStreamId}/${quality}.m3u8`;
            
            ws.send(JSON.stringify({
              type: 'joined-stream',
              streamId: joinStreamId,
              streamName: stream.name,
              hlsUrl: hlsUrl,
              masterHlsUrl: stream.status === 'archived' 
                ? `/api/archived-hls/${joinStreamId}/master.m3u8`
                : `/api/live-hls/${joinStreamId}/master.m3u8`,
              status: stream.status,
              quality: quality,
              availableQualities: stream.qualities
            }));
            
            // Update viewer count
            broadcastToAll({
              type: 'viewer-count-update',
              streamId: joinStreamId,
              viewers: stream.viewers.size
            });
            
            console.log(`Client ${clientId} joined stream ${joinStreamId} with quality ${quality}`);
          } else {
            ws.send(JSON.stringify({
              type: 'stream-not-found',
              streamId: joinStreamId
            }));
          }
          break;

        case 'change-quality':
          if (client.currentStream) {
            const stream = liveStreams.get(client.currentStream);
            const newQuality = message.quality || '720p';
            
            if (stream) {
              client.selectedQuality = newQuality;
              
              const hlsUrl = stream.status === 'archived' 
                ? `/api/archived-hls/${client.currentStream}/${newQuality}.m3u8`
                : `/api/live-hls/${client.currentStream}/${newQuality}.m3u8`;
              
              ws.send(JSON.stringify({
                type: 'quality-changed',
                streamId: client.currentStream,
                quality: newQuality,
                hlsUrl: hlsUrl
              }));
            }
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

        case 'get-archived-streams':
          ws.send(JSON.stringify({
            type: 'archived-streams',
            streams: getArchivedStreams()
          }));
          break;

        default:
          console.log('Unknown message type:', message.type);
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Error processing message'
      }));
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    
    const client = clients.get(clientId);
    if (client) {
      // If client was streaming, stop the stream
      if (client.isStreamer && client.currentStream) {
        const stream = liveStreams.get(client.currentStream);
        if (stream) {
          stream.status = 'stopping';
          stream.endTime = Date.now();
          
          if (stream.inputPipe) {
            stream.inputPipe.end();
          }
          
          if (stream.ffmpegProcess) {
            stream.ffmpegProcess.kill('SIGTERM');
          }
          
          broadcastToAll({
            type: 'stream-ended',
            streamId: client.currentStream,
            archived: stream.preserveAfterStop
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
app.get('/api/live-hls/:streamId/:filename', (req: any, res: any) => {
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
  setHLSHeaders(res, filename);
  res.sendFile(filePath);
});

// API endpoint to serve archived HLS streams
app.get('/api/archived-hls/:streamId/:filename', (req: any, res: any) => {
  const { streamId, filename } = req.params;
  const stream = liveStreams.get(streamId);
  
  if (!stream || stream.status !== 'archived') {
    return res.status(404).json({ error: 'Archived stream not found' });
  }
  
  const filePath = path.join(archivedHlsDir, streamId, filename);
  
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Set appropriate headers
  setHLSHeaders(res, filename);
  res.sendFile(filePath);
});

// Set HLS headers helper function
function setHLSHeaders(res: any, filename: string) {
  if (filename.endsWith('.m3u8')) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else if (filename.endsWith('.ts')) {
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Cache-Control', 'public, max-age=31536000');
  }
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control');
}

// API endpoint to get active streams
app.get('/api/live-streams', (req: Request, res: Response) => {
  res.json({
    streams: getActiveStreams()
  });
});

// API endpoint to get archived streams
app.get('/api/archived-streams', (req: Request, res: Response) => {
  res.json({
    streams: getArchivedStreams()
  });
});

// API endpoint to get stream info
app.get('/api/live-streams/:streamId', (req: any, res: any) => {
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
    endTime: stream.endTime,
    uptime: stream.endTime ? (stream.endTime - stream.startTime) : (Date.now() - stream.startTime),
    hlsUrl: stream.status === 'archived' 
      ? `/api/archived-hls/${streamId}/master.m3u8`
      : `/api/live-hls/${streamId}/master.m3u8`,
    qualities: stream.qualities
  });
});

// Health check endpoint
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    activeStreams: Array.from(liveStreams.values()).filter(s => s.status === 'live' || s.status === 'starting').length,
    archivedStreams: Array.from(liveStreams.values()).filter(s => s.status === 'archived').length,
    connectedClients: clients.size,
    timestamp: new Date().toISOString()
  });
});

// API endpoint to check FFmpeg status
app.get('/api/ffmpeg/status', async (req: Request, res: Response) => {
  try {
    const available = await checkFFmpeg();
    res.json({ available, path: FFMPEG_PATH });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    res.json({ available: false, error: errorMessage });
  }
});

// Cleanup function
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  
  // Stop all active streams
  liveStreams.forEach((stream) => {
    if (stream.ffmpegProcess) {
      stream.ffmpegProcess.kill('SIGTERM');
    }
  });
  
  // Note: We don't clean up HLS directories on shutdown to preserve archived content
  console.log('Archived streams preserved');
  
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`FFmpeg path: ${FFMPEG_PATH}`);
  console.log('Real-time HLS streaming server ready');
  console.log(`Live streams directory: ${liveHlsDir}`);
  console.log(`Archived streams directory: ${archivedHlsDir}`);
});

export default server;