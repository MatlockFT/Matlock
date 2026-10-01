# Running a continuous broadcast

1. Sign in at `/broadcast/control/` and open **Media**.
2. Choose **Upload Media**, or drop multiple video and audio files onto the library. Leave **Add successful uploads to the draft loop automatically** checked to build the playlists as files finish. Uncheck it to store files for later reuse. **Add all unused media to draft** adds library files not already in the current draft.
3. The upload queue keeps an outcome for each file. A rejected file does not cancel later files. Temporary chunk failures retry automatically; **Retry** retries an individual failed file. **Stop after current file** leaves the current file to finish and skips the rest. Keep the tab open until uploads finish.
4. In **Rundown**, arrange video/image/text blocks. Use the arrow buttons or drag blocks. Titles and durations are filled from uploaded files. **Preview this item** jumps to that block; **Restart preview** starts from the beginning. Editing text or mixer settings does not restart the preview.
5. In **Audio**, arrange the independent repeating music playlist. **Upload Songs** also accepts music in an MP4/M4V/WebM container and uses its sound only. Preview a track with the audio player in its inspector, or use **Listen** to hear the complete mix.
6. **Save Draft** stores the playlists and uploaded metadata without changing the broadcast. **Take Preview Live** saves the draft and restarts the public loop with it. Open `/broadcast/` on the playback device and enable sound once. Existing viewers poll for changes approximately every 12 seconds.

## News Pool

Open **News Pool** to browse the existing MMA article feed alongside recent videos from MMA Fighting, MMA Junkie, UFC, ESPN MMA and MMAWeekly. Search by fighter, event or topic, filter by content/source, and hide items already in the draft. **Refresh** checks for the newest snapshot; freshness and failed source notices remain visible. The existing GitHub news job updates both feeds approximately every five minutes. The Videos tab collector reads public channel pages, whose structure can change; a failed channel retains recent cached videos and reports its status. A bundled snapshot is available if the live feed cannot be reached.

**Add headline** creates an editable 20-second headline with a short excerpt and source credit. **Add to ticker** appends the headline and source. **Add video** inserts a visible YouTube program block with its known duration. Original source links remain in the inspector. Duplicate additions are disabled, and Undo/Redo includes these changes. These actions only edit Preview; Save Draft and Take Preview Live retain their usual roles.

Only known video lengths **over three minutes** are eligible, conservatively excluding the entire Shorts duration range. This also excludes regular videos of three minutes or less. Scheduled/live entries, explicit Shorts and unknown lengths are omitted. Videos are drawn from the last two weeks; relative upload times are approximate and labeled as such.

Use **Preview video** to check the official YouTube embed. In Rundown, shorten its playback duration to trim the end, mute original audio, or choose the music behavior. Master and Video mixer levels apply. YouTube links can also be added to the independent audio playlist from **Music URL**; the YouTube video remains hidden while its audio is mixed with the music bed, including gain, ducking, fades and crossfades. The video stays visible with YouTube controls when used as a rundown video; on compact monitors it uses the complete screen so controls fit. Embedding restrictions, browser autoplay rules, ads and network availability are controlled by YouTube/browser. Failed embeds are skipped and retried after a minute.

## Recovery, editing and large libraries

Unsaved edits are backed up in this browser under your GitHub account. After a refresh, use **Restore to Preview** to recover them or **Discard backup** to keep the saved draft. Recovery never changes Program. Review a recovered draft before saving, especially if the saved state changed since the backup. Browser backups are local to this device and can be lost when browser storage is cleared; Save Draft stores your work in the account. Files that have not finished uploading cannot be recovered.

**Undo** and **Redo** restore up to 60 recent edit states, including removed or reordered items. Typing is grouped into short edit sequences. The shortcuts are Ctrl/⌘+Z and Ctrl/⌘+Shift+Z outside text fields; inside a text field, the browser retains its normal text undo. These controls change Preview only. They do not undo an upload, delete, or Take Live operation.

The readiness list shows every item with a missing duration or media link. Click an issue to open that item's inspector. These are configuration checks; use Preview and Listen to check the files and mix before taking the loop live.

The library displays 40 files per page. Search, filtering and sorting cover the entire library. **Add all unused media to draft** also covers all pages and shows progress; **Stop adding after this file** keeps the files already added and leaves the rest in the library.

## Formats and links

- Recommended video: MP4 containing H.264 video and AAC audio. WebM and M4V are also accepted if the browser can read them.
- Recommended music: MP3 or M4A/AAC. WAV, OGG, Opus and FLAC can also be used where the browser supports them.
- Each file must be non-empty and smaller than 2 GiB. The existing upload service stores media in GitHub Releases. It does **not** transcode files. A familiar extension does not guarantee a supported codec.
- Use a direct media file URL, not a watch page, sharing page, or GitHub asset-details API URL. The editor resolves this repository's GitHub asset-details URLs to download URLs and reads their duration when repairing an old draft.
- Music URL accepts either a YouTube video link or a direct media URL. YouTube metadata is read through the official iframe player when possible; direct media metadata is read through the browser. Enter the track length as min:sec when automatic duration detection is unavailable. MP3, M4A/AAC, WAV, OGG, Opus and FLAC are supported where the browser can play them; MP4/M4V/WebM may also be used as audio containers.
- Video duration can be read again or entered as min:sec; image duration is editable in seconds. Missing or invalid durations block Take Live rather than silently using 30 seconds or three minutes.

## Text layout and long bodies

The player uses a single 640 × 480 composition based on the Control monitor. The homepage, public feed and other embeds scale that same 4:3 stage, including typography, spacing and body pages. Embeds in a different aspect ratio are centered with space around the stage instead of stretching it. Gold-band labels and footer text use the actual font metrics for alignment; clock digits share a stable baseline.

Title, eyebrow and header band fit their available space automatically on every text block, including manual headlines, results, events and breaking news. The body wraps long words/URLs and fits at a readable size. When it is too long for one screen, **PAGE 1 / N** appears and the body advances through complete pages over the block's existing duration. No characters are discarded. The title, eyebrow and header remain visible on each page; pages restart when the block repeats. Layout recalculates when the monitor size changes, fonts load or text is edited.

The text inspector shows the body character count, the current Preview's page count, seconds per page and suggested reading time. **Use suggested reading time** adjusts the draft duration when more time is needed. Shorter headings make larger text possible. Preview and Program use the same page layout for the same content at every display size. These layout changes do not alter your saved text or publish a new rundown.

## Audio behavior

Master affects video and music. Video controls original clip sound; Music controls the music bed. **Duck** lowers music to the selected percentage when video sound is enabled; **Mute** silences the music during that video; **Keep playing** mixes both. A muted video does not duck the music. Per-video choices override the global setting. Crossfade overlaps adjacent music tracks; fades can also be adjusted per track.

Listen is local monitoring, not a broadcast mute switch. Only one monitor is audible at a time. Browsers may require a click on the player's sound control before allowing audio. If blocked, that control becomes visible and the dashboard explains what to click.

The public player skips media that fails to load or stalls, continues with available content, and retries failed sources after one minute. If no playable visual items remain, it displays standby while it waits. This is a browser-based loop: keep the playback device awake and connected. Broadcasting to a streaming platform still requires a separate capture/streaming setup.

## Validation and deployment

`npx playwright test scripts/writer/broadcast-loop.spec.cjs --workers=1` uses a local fixture service, real short audio files, and simulated backend failures. No test publishes media or changes production. `node scripts/writer/broadcast-test-server.cjs` starts an isolated manual preview at `http://127.0.0.1:4190/broadcast/control/`.

The site changes deploy through the existing Pages workflow. The Netlify auth bridge must also receive the updated `writer-media-library.mjs` to return music as well as video. Until that happens, the control room supplements the old video-only response with the public GitHub release index. That fallback is subject to GitHub's unauthenticated API limits. Existing saved broadcast content is not changed by this code update.
