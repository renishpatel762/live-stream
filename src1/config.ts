import path from 'path';

// config.ts
export default {
    rtmp: {
      port: 1935,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60
    },
    http: {
      port: 8000,
      allow_origin: '*',
      mediaroot: path.resolve(__dirname, '../../media')    ,
    },
    trans: {
      ffmpeg: 'C:/ffmpeg/bin/ffmpeg.exe', // adjust path if needed
      tasks: [
        {
          app: 'live',
          rtmp: true,  
          hls: true,
          masterPlaylistName: 'master.m3u8',
          hlsFlags: "[hls_time=4:hls_list_size=5:delete_segments]",
          hlsSegmentFilename: "D:/dev/project/media/hls/stream_%v/segment_%d.ts",
          hlsPlaylist:        "D:/dev/project/media/hls/stream_%v/playlist.m3u8",
          varStreamMap: 'v:0,a:0,name:1080p v:1,a:0,name:720p v:2,a:0,name:480p',
          vc: [
            { codec: 'libx264', preset: 'veryfast', profile: 'main', scale: '-2:1080', bitrate: '3000k' },
            { codec: 'libx264', preset: 'veryfast', profile: 'main', scale: '-2:720',  bitrate: '1500k' },
            { codec: 'libx264', preset: 'veryfast', profile: 'main', scale: '-2:480',  bitrate: '800k' },
          ],
          ac: { codec: 'aac', bitrate: '128k' },
        },
      ],
    },
  };
  