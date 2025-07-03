// server.js
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

// Create a WebSocket server on port 8080
const wss = new WebSocketServer({ port: 9090 }, () => {
  console.log('WebSocket server listening on ws://localhost:9090');
});

wss.on('connection', (ws, req) => {
  // Generate a unique filename per connection
  const filename = `video-${Date.now()}.webm`;
  const filepath = path.join(uploadDir, filename);
  const fileStream = fs.createWriteStream(filepath, { flags: 'a' });
  console.log(`▶️  Started recording to ${filename}`);

  ws.on('message', (data) => {
    // data is a Buffer; write it directly to disk
    fileStream.write(data);
  });

  ws.on('close', (code, reason) => {
    fileStream.end();
    console.log(`✅  Finished recording ${filename} (${code}${reason ? `; ${reason}` : ''})`);
  });

  ws.on('error', (err) => {
    console.error('⚠️  WebSocket error:', err);
    fileStream.end();
  });
});
