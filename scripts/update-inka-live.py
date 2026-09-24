#!/usr/bin/env python3
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATE_PATH = ROOT / "assets" / "data" / "inka-live.json"
SEED_URL = os.environ.get(
    "INKA_SEED_VIDEO_URL",
    "https://www.youtube.com/watch?v=C2nNtrk8FRs",
)

NEGATIVE_TITLE_TERMS = (
    "weigh-in",
    "weigh in",
    "pesaje",
    "press conference",
    "conferencia",
    "interview",
    "entrevista",
    "podcast",
    "reaction",
    "reacción",
    "highlights",
    "resumen",
    "trailer",
    "countdown",
)


def load_state():
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def ytdlp_json(url, flat=False, playlist_end=None):
    command = [
        "yt-dlp",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
    ]
    if flat:
        command.append("--flat-playlist")
    if playlist_end:
        command.extend(["--playlist-end", str(playlist_end)])
    command.append(url)

    result = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=120,
    )
    if result.returncode != 0:
        return None, result.stderr.strip()

    try:
        return json.loads(result.stdout), ""
    except json.JSONDecodeError:
        return None, "yt-dlp returned invalid JSON"


def is_live(info):
    if not isinstance(info, dict):
        return False
    return info.get("is_live") is True or info.get("live_status") == "is_live"


def allowed_fight_stream(title):
    lowered = (title or "").casefold()
    return not any(term in lowered for term in NEGATIVE_TITLE_TERMS)


def pick_live_entry(streams):
    entries = streams.get("entries") if isinstance(streams, dict) else None
    if not entries:
        return None
    for entry in entries:
        if is_live(entry) and allowed_fight_stream(entry.get("title")):
            return entry
    return None


def core(state):
    keys = (
        "promotion",
        "channel_name",
        "channel_id",
        "channel_url",
        "is_live",
        "status",
        "video_id",
        "title",
        "watch_url",
    )
    return {key: state.get(key) for key in keys}


def main():
    previous = load_state()
    channel_id = previous.get("channel_id")
    channel_name = previous.get("channel_name") or "INKA MMA PRO"

    if not channel_id:
        seed, error = ytdlp_json(SEED_URL)
        if not seed:
            print(f"Could not resolve Inka channel from seed video: {error}", file=sys.stderr)
            return 0
        channel_id = seed.get("channel_id") or seed.get("uploader_id")
        channel_name = seed.get("channel") or seed.get("uploader") or channel_name

    if not channel_id:
        print("Inka channel ID was not available in seed metadata.", file=sys.stderr)
        return 0

    channel_url = f"https://www.youtube.com/channel/{channel_id}"
    streams_url = f"{channel_url}/streams"

    streams, streams_error = ytdlp_json(streams_url, flat=True, playlist_end=12)
    if not streams:
        print(f"Could not inspect Inka streams tab; preserving last state: {streams_error}", file=sys.stderr)
        return 0

    live = pick_live_entry(streams)

    if live:
        video_id = live.get("id")
        live_title = live.get("title") or "Inka MMA live"
        candidate = {
            "promotion": "Inka Fighting Championship",
            "channel_name": channel_name,
            "channel_id": channel_id,
            "channel_url": channel_url,
            "is_live": True,
            "status": "live",
            "video_id": video_id,
            "title": live_title,
            "watch_url": f"https://www.youtube.com/watch?v={video_id}" if video_id else channel_url,
        }
    else:
        # Probe the canonical /live route as a second check. If it resolves to
        # an actual live video, use it; otherwise the channel is considered off air.
        direct, _ = ytdlp_json(f"{channel_url}/live")
        if direct and is_live(direct) and allowed_fight_stream(direct.get("title")):
            video_id = direct.get("id")
            candidate = {
                "promotion": "Inka Fighting Championship",
                "channel_name": direct.get("channel") or direct.get("uploader") or channel_name,
                "channel_id": channel_id,
                "channel_url": channel_url,
                "is_live": True,
                "status": "live",
                "video_id": video_id,
                "title": direct.get("title") or "Inka MMA live",
                "watch_url": f"https://www.youtube.com/watch?v={video_id}" if video_id else channel_url,
            }
        else:
            candidate = {
                "promotion": "Inka Fighting Championship",
                "channel_name": channel_name,
                "channel_id": channel_id,
                "channel_url": channel_url,
                "is_live": False,
                "status": "offline",
                "video_id": None,
                "title": "Inka MMA is off air",
                "watch_url": channel_url,
            }

    if core(candidate) == core(previous):
        print("Inka live state unchanged.")
        return 0

    candidate["updated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(candidate, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(candidate, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
