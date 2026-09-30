# Running a continuous broadcast

1. Sign in at `/broadcast/control/` and open **Media**.
2. Choose **Upload Media**, or drop multiple video and audio files onto the library. Leave **Add successful uploads to the draft loop automatically** checked to build the playlists as files finish. Uncheck it to store files for later reuse. **Add all unused media to draft** adds library files not already in the current draft.
3. The upload queue keeps an outcome for each file. A rejected file does not cancel later files. Temporary chunk failures retry automatically; **Retry** retries an individual failed file. **Stop after current file** leaves the current file to finish and skips the rest. Keep the tab open until uploads finish.
4. In **Rundown**, arrange video/image/text blocks. Use the arrow buttons or drag blocks. Titles and durations are filled from uploaded files. **Preview this item** jumps to that block; **Restart preview** starts from the beginning. Editing text or mixer settings does not restart the preview.
5. In **Audio**, arrange the independent repeating music playlist. **Upload Songs** also accepts music in an MP4/M4V/WebM container and uses its sound only. Preview a track with the audio player in its inspector, or use **Listen** to hear the complete mix.
6. **Save Draft** stores the playlists and uploaded metadata without changing the broadcast. **Take Preview Live** saves the draft and restarts the public loop with it. Open `/broadcast/` on the playback device and enable sound once. Existing viewers poll for changes approximately every 12 seconds.

## Formats and links

- Recommended video: MP4 containing H.264 video and AAC audio. WebM and M4V are also accepted if the browser can read them.
- Recommended music: MP3 or M4A/AAC. WAV, OGG, Opus and FLAC can also be used where the browser supports them.
- Each file must be non-empty and smaller than 2 GiB. The existing upload service stores media in GitHub Releases. It does **not** transcode files. A familiar extension does not guarantee a supported codec.
- Use a direct media file URL, not a watch page, sharing page, or GitHub asset-details API URL. The editor resolves this repository's GitHub asset-details URLs to download URLs and reads their duration when repairing an old draft.
- New direct music URLs must load successfully before being added. YouTube music is excluded from continuous playback and blocks Take Live until replaced. Older drafts are preserved and display a warning; upload the audio file or use a playable direct URL.
- Video duration can be read again or entered as min:sec; image duration is editable in seconds. Missing or invalid durations block Take Live rather than silently using 30 seconds or three minutes.

## Audio behavior

Master affects video and music. Video controls original clip sound; Music controls the music bed. **Duck** lowers music to the selected percentage when video sound is enabled; **Mute** silences the music during that video; **Keep playing** mixes both. A muted video does not duck the music. Per-video choices override the global setting. Crossfade overlaps adjacent music tracks; fades can also be adjusted per track.

Listen is local monitoring, not a broadcast mute switch. Only one monitor is audible at a time. Browsers may require a click on the player's sound control before allowing audio. If blocked, that control becomes visible and the dashboard explains what to click.

The public player skips media that fails to load or stalls, continues with available content, and retries failed sources after one minute. If no playable visual items remain, it displays standby while it waits. This is a browser-based loop: keep the playback device awake and connected. Broadcasting to a streaming platform still requires a separate capture/streaming setup.

## Validation and deployment

`npx playwright test scripts/writer/broadcast-loop.spec.cjs --workers=1` uses a local fixture service, real short audio files, and simulated backend failures. No test publishes media or changes production. `node scripts/writer/broadcast-test-server.cjs` starts an isolated manual preview at `http://127.0.0.1:4190/broadcast/control/`.

The site changes deploy through the existing Pages workflow. The Netlify auth bridge must also receive the updated `writer-media-library.mjs` to return music as well as video. Until that happens, the control room supplements the old video-only response with the public GitHub release index. That fallback is subject to GitHub's unauthenticated API limits. Existing saved broadcast content is not changed by this code update.
