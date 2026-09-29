# Direct OBS stream test

This is the self-hosted path for the hidden test page at `/live-test/`.

Flow:

```
/broadcast/ -> OBS -> MediaMTX -> Caddy/HTTPS -> /live-test/
```

No YouTube ingest or YouTube player is involved.

## 1. MediaMTX

Download the current Windows AMD64 MediaMTX release and place `mediamtx.exe` wherever you want to run it.

From the repository root:

```powershell
C:\path\to\mediamtx.exe scripts\broadcast\mediamtx.yml
```

The configuration intentionally binds both RTMP ingest and HLS output to localhost.

OBS publishes locally to:

```
rtmp://127.0.0.1:1935/matlock
```

Stream key: leave blank.

MediaMTX then exposes the local HLS rendition at:

```
http://127.0.0.1:8888/matlock/index.m3u8
```

## 2. OBS

Settings -> Stream:

- Service: Custom
- Server: `rtmp://127.0.0.1:1935/matlock`
- Stream key: blank

Recommended starting output:

- H.264 / NVENC
- AAC audio
- 1920x1080
- 30 fps
- CBR
- 6000 Kbps video
- 2-second keyframe interval

The OBS program can continue using `https://mmamatlock.com/broadcast/` as its browser source.

## 3. HTTPS public endpoint

The hidden website page is configured to read:

```
https://live.mmamatlock.com/matlock/index.m3u8
```

Install Caddy on the Windows machine and run:

```powershell
caddy run --config scripts\broadcast\Caddyfile
```

Create a DNS record for `live.mmamatlock.com` pointing to the public IP of the machine/network running Caddy.

For a direct home-hosted test, forward TCP ports 80 and 443 from the router to this Windows machine. Do **not** forward port 1935; OBS and MediaMTX communicate locally.

If the ISP uses CGNAT or otherwise prevents inbound connections, the HLS origin or a tunnel has to run somewhere publicly reachable instead.

## 4. Test page

Open:

```
https://mmamatlock.com/live-test/
```

The page is intentionally not linked from navigation and includes `noindex,nofollow,noarchive`.

To test another HLS endpoint without changing the repository:

```
https://mmamatlock.com/live-test/?src=https%3A%2F%2Fexample.com%2Fstream.m3u8
```

The player uses native HLS when available and hls.js otherwise. It retries network failures automatically.
