const WebSocket = require('ws');
const { spawn } = require('child_process');
const EventEmitter = require('events');

class WebSocketToRTMP extends EventEmitter {
    constructor(options = {}) {
        super();
        this.rtmpUrl = options.rtmpUrl || 'rtmp://localhost:1935/live/stream';
        this.wsPort = options.wsPort || 8080;
        this.ffmpegPath = options.ffmpegPath || 'ffmpeg';
        this.ffmpegProcess = null;
        this.wsServer = null;
        this.isStreaming = false;
        this.debugMode = options.debug || false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.firstChunkReceived = false;
        this.inputFormat = null;
        this.bufferQueue = [];
        this.isProcessingBuffer = false;
    }

    startWebSocketServer() {
        this.wsServer = new WebSocket.Server({ 
            port: this.wsPort,
            perMessageDeflate: false,
            maxPayload: 10 * 1024 * 1024 // 10MB max payload
        });

        this.wsServer.on('connection', (ws, req) => {
            console.log(`WebSocket client connected from ${req.socket.remoteAddress}`);
            this.reconnectAttempts = 0;
            this.firstChunkReceived = false;
            this.inputFormat = null;
            
            ws.on('message', (data) => {
                console.log(`Received ${data.length} bytes from WebSocket`);
                this.handleVideoData(data);
            });

            ws.on('close', () => {
                console.log('WebSocket client disconnected');
                this.stopFFmpeg();
                this.resetState();
            });

            ws.on('error', (error) => {
                console.error('WebSocket error:', error);
                this.stopFFmpeg();
                this.resetState();
            });
        });

        this.wsServer.on('error', (error) => {
            console.error('WebSocket server error:', error);
        });

        console.log(`WebSocket server listening on port ${this.wsPort}`);
        this.emit('wsServerStarted', this.wsPort);
    }

    resetState() {
        this.firstChunkReceived = false;
        this.inputFormat = null;
        this.bufferQueue = [];
        this.isProcessingBuffer = false;
    }

    detectInputFormat(data) {
        // Check for common video file signatures
        const signatures = {
            mp4: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], // ftyp box
            mp4_alt: [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], // ftyp box variant
            webm: [0x1A, 0x45, 0xDF, 0xA3], // WebM signature
            flv: [0x46, 0x4C, 0x56], // FLV signature
            h264_annexb: [0x00, 0x00, 0x00, 0x01], // H.264 Annex B
            h264_avcc: [0x00, 0x00, 0x00, 0x01, 0x09] // H.264 AVCC
        };

        for (const [format, signature] of Object.entries(signatures)) {
            if (this.matchesSignature(data, signature)) {
                console.log(`Detected input format: ${format}`);
                return format;
            }
        }

        // Check if it looks like fragmented MP4 (common for WebRTC/MediaRecorder)
        if (data.length > 8) {
            const boxType = data.slice(4, 8).toString('ascii');
            if (['ftyp', 'moov', 'moof', 'mdat'].includes(boxType)) {
                console.log('Detected fragmented MP4');
                return 'fmp4';
            }
        }

        console.warn('Unknown input format detected');
        return 'unknown';
    }

    matchesSignature(data, signature) {
        if (data.length < signature.length) return false;
        
        for (let i = 0; i < signature.length; i++) {
            if (data[i] !== signature[i]) return false;
        }
        return true;
    }

    handleVideoData(data) {
        if (!this.firstChunkReceived) {
            this.inputFormat = this.detectInputFormat(data);
            this.firstChunkReceived = true;
            
            // Log first few bytes for debugging
            if (this.debugMode) {
                const hex = Array.from(data.slice(0, 16))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join(' ');
                console.log(`First 16 bytes: ${hex}`);
            }
        }

        // Add to buffer queue
        this.bufferQueue.push(data);

        if (!this.isStreaming) {
            this.startFFmpeg();
        }

        this.processBufferQueue();
    }

    processBufferQueue() {
        if (this.isProcessingBuffer || this.bufferQueue.length === 0) return;
        if (!this.ffmpegProcess || !this.ffmpegProcess.stdin || !this.ffmpegProcess.stdin.writable) return;

        this.isProcessingBuffer = true;

        while (this.bufferQueue.length > 0) {
            const data = this.bufferQueue.shift();
            
            try {
                const written = this.ffmpegProcess.stdin.write(data);
                if (!written) {
                    // Backpressure - put data back and wait for drain
                    this.bufferQueue.unshift(data);
                    this.ffmpegProcess.stdin.once('drain', () => {
                        this.isProcessingBuffer = false;
                        this.processBufferQueue();
                    });
                    return;
                }
            } catch (error) {
                console.error('Error writing to FFmpeg stdin:', error);
                this.restartFFmpeg();
                break;
            }
        }

        this.isProcessingBuffer = false;
    }

    getFFmpegArgs() {
        // Base arguments that work for most formats
        let args = [
            '-i', 'pipe:0',
            '-analyzeduration', '5000000',  // Increased for better format detection
            '-probesize', '5000000',        // Increased for better format detection
            '-fflags', '+genpts+igndts',    // Generate PTS and ignore DTS
            '-avoid_negative_ts', 'make_zero'
        ];

        // Format-specific optimizations
        if (this.inputFormat === 'fmp4' || this.inputFormat === 'mp4') {
            args.push(
                '-movflags', '+frag_keyframe+empty_moov+faststart'
            );
        }

        // Video encoding
        args.push(
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-tune', 'zerolatency',
            '-profile:v', 'baseline',  // More compatible than main
            '-level', '3.1',           // Lower level for better compatibility
            '-pix_fmt', 'yuv420p',
            '-r', '30',
            '-g', '60',                // GOP size
            '-keyint_min', '30',
            '-sc_threshold', '0',
            '-b:v', '1500k',           // Slightly lower bitrate
            '-maxrate', '2000k',
            '-bufsize', '3000k'
        );

        // Audio encoding
        args.push(
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '48000',
            '-ac', '2',
            '-strict', '-2'
        );

        // Output format and streaming settings
        args.push(
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            '-muxdelay', '0',
            '-muxpreload', '0',
            '-max_muxing_queue_size', '2048',
            '-rtmp_live', 'live',
            this.rtmpUrl
        );

        return args;
    }

    startFFmpeg() {
        if (this.ffmpegProcess) {
            return;
        }

        console.log(`Starting FFmpeg stream to ${this.rtmpUrl}`);
        
        const ffmpegArgs = this.getFFmpegArgs();

        if (this.debugMode) {
            console.log('FFmpeg command:', this.ffmpegPath, ffmpegArgs.join(' '));
        }

        this.ffmpegProcess = spawn(this.ffmpegPath, ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, AV_LOG_FORCE_COLOR: '1' }
        });
        
        this.isStreaming = true;

        // Handle stdout (usually empty for streaming)
        this.ffmpegProcess.stdout.on('data', (data) => {
            if (this.debugMode) {
                console.log(`FFmpeg stdout: ${data}`);
            }
        });

        // Enhanced stderr handling
        this.ffmpegProcess.stderr.on('data', (data) => {
            const message = data.toString();
            
            // Progress indicators
            if (message.includes('frame=') && message.includes('time=')) {
                if (this.debugMode) {
                    // Extract useful info from progress line
                    const frameMatch = message.match(/frame=\s*(\d+)/);
                    const timeMatch = message.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
                    if (frameMatch && timeMatch) {
                        console.log(`Streaming: Frame ${frameMatch[1]}, Time ${timeMatch[1]}`);
                    }
                }
            }
            // Stream detection
            else if (message.includes('Stream #0:')) {
                console.log(`Input stream detected: ${message.trim()}`);
            }
            // Output stream info
            else if (message.includes('Output #0,') || message.includes('Stream mapping:')) {
                console.log(`FFmpeg info: ${message.trim()}`);
            }
            // Errors
            else if (message.toLowerCase().includes('error')) {
                console.error(`FFmpeg error: ${message.trim()}`);
            }
            // Warnings
            else if (message.toLowerCase().includes('warning')) {
                console.warn(`FFmpeg warning: ${message.trim()}`);
            }
        });

        this.ffmpegProcess.on('close', (code) => {
            console.log(`⚠ FFmpeg process closed with code ${code}`);
            this.isStreaming = false;
            this.ffmpegProcess = null;
            this.bufferQueue = []; // Clear buffer on restart
            
            // Auto-restart logic
            if (code !== 0 && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                console.log(`Attempting to restart FFmpeg (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
                setTimeout(() => {
                    if (this.wsServer && this.wsServer.clients.size > 0) {
                        this.startFFmpeg();
                    }
                }, 2000);
            } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                console.error('Max reconnection attempts reached. Manual intervention required.');
                this.emit('maxReconnectAttemptsReached');
            }
            
            this.emit('ffmpegClosed', code);
        });

        this.ffmpegProcess.on('error', (error) => {
            console.error('FFmpeg process error:', error);
            this.isStreaming = false;
            this.ffmpegProcess = null;
            this.emit('ffmpegError', error);
        });

        // Handle stdin errors gracefully
        this.ffmpegProcess.stdin.on('error', (error) => {
            console.error('FFmpeg stdin error:', error);
            if (error.code !== 'EPIPE') { // EPIPE is normal when FFmpeg closes
                this.restartFFmpeg();
            }
        });

        console.log('✓ FFmpeg streaming started');
        this.emit('ffmpegStarted');
    }

    stopFFmpeg() {
        if (this.ffmpegProcess) {
            console.log('Stopping FFmpeg process');
            
            // Clear buffer queue
            this.bufferQueue = [];
            
            // Close stdin gracefully
            if (this.ffmpegProcess.stdin && this.ffmpegProcess.stdin.writable) {
                this.ffmpegProcess.stdin.end();
            }
            
            // Send SIGTERM
            this.ffmpegProcess.kill('SIGTERM');
            
            // Force kill if it doesn't terminate gracefully
            setTimeout(() => {
                if (this.ffmpegProcess) {
                    console.log('Force killing FFmpeg process');
                    this.ffmpegProcess.kill('SIGKILL');
                }
            }, 5000);
        }
        
        this.isStreaming = false;
    }

    restartFFmpeg() {
        console.log('Restarting FFmpeg process');
        this.stopFFmpeg();
        setTimeout(() => {
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.startFFmpeg();
            }
        }, 1000);
    }

    // Test RTMP server connectivity
    async testRTMPConnection() {
        return new Promise((resolve, reject) => {
            console.log('Testing RTMP connection...');
            
            const testArgs = [
                '-f', 'lavfi',
                '-i', 'testsrc=duration=5:size=640x480:rate=30',
                '-f', 'lavfi', 
                '-i', 'sine=frequency=1000:duration=5',
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-c:a', 'aac',
                '-f', 'flv',
                '-t', '5',
                this.rtmpUrl
            ];

            const testProcess = spawn(this.ffmpegPath, testArgs);
            let hasError = false;

            testProcess.stderr.on('data', (data) => {
                const message = data.toString();
                if (message.includes('Connection refused') || message.includes('No route to host')) {
                    hasError = true;
                    console.error('❌ RTMP server is not reachable');
                } else if (message.includes('Stream #0:')) {
                    console.log('✓ Test stream started');
                }
            });

            testProcess.on('close', (code) => {
                if (code === 0 && !hasError) {
                    console.log('✓ RTMP connection test successful');
                    resolve(true);
                } else {
                    console.error(`❌ RTMP connection test failed (code: ${code})`);
                    reject(new Error(`Test failed with code ${code}`));
                }
            });

            testProcess.on('error', (error) => {
                console.error('❌ FFmpeg test process error:', error);
                reject(error);
            });
        });
    }

    stop() {
        console.log('Shutting down WebSocket to RTMP forwarder');
        this.stopFFmpeg();
        
        if (this.wsServer) {
            this.wsServer.close();
        }
        
        this.resetState();
    }
}

// Usage example
async function main() {
    const forwarder = new WebSocketToRTMP({
        rtmpUrl: 'rtmp://localhost:1935/live/stream',
        wsPort: 9090,
        ffmpegPath: 'ffmpeg',
        debug: true
    });

    // Test RTMP connection first
    try {
        await forwarder.testRTMPConnection();
    } catch (error) {
        console.error('⚠ RTMP test failed. Make sure your RTMP server is running on port 1935');
        console.log('You can start a simple RTMP server with:');
        console.log('  npm install node-media-server');
        console.log('  node rtmp-server.js (see the provided server code)');
    }

    // Event listeners
    forwarder.on('wsServerStarted', (port) => {
        console.log(`✓ WebSocket server started on port ${port}`);
        console.log('You can now send video stream to ws://localhost:' + port);
    });

    forwarder.on('ffmpegStarted', () => {
        console.log('✓ FFmpeg streaming started');
    });

    forwarder.on('maxReconnectAttemptsReached', () => {
        console.error('❌ Max reconnection attempts reached. Check your RTMP server and input stream.');
    });

    // Start the WebSocket server
    forwarder.startWebSocketServer();

    // Graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nReceived SIGINT, shutting down gracefully...');
        forwarder.stop();
        process.exit(0);
    });
}

if (require.main === module) {
    main();
}

module.exports = WebSocketToRTMP;