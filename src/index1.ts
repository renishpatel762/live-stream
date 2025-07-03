import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import * as fs from 'fs';
import * as path from 'path';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Serve static files
app.use(express.static('public'));

// Store for active video recordings
const recordings = new Map<string, { 
  chunks: Buffer[], 
  startTime: number,
  filename: string 
}>();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  let recordingId: string | null = null;

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
            recordings.get(recordingId)!.chunks.push(chunk);
          }
          break;

        case 'stop-recording':
          if (recordingId && recordings.has(recordingId)) {
            const recording = recordings.get(recordingId)!;
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
    } catch (error) {
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
  } catch (error) {
    res.status(500).json({ error: 'Failed to list videos' });
  }
});

// API endpoint to download videos
app.get('/api/videos/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);
  
  if (fs.existsSync(filePath)) {
    res.download(filePath);
  } else {
    res.status(404).json({ error: 'Video not found' });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export default server;