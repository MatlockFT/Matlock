#!/usr/bin/env python3
import json
import subprocess
import sys
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "assets" / "data" / "live-promotions.json"
STATE_PATH = ROOT / "assets" / "data" / "global-live.json"

MAX_STALE_ERRORS = 6
MAX_WORKERS = 6
IDLE_BATCH_COUNT = 3

RESTRICTED_AVAILABILITY = {
    "private",
    "premium_only",
    "subscriber_only",
    "needs_auth",
}


def now():
    return datetime.now(timezone.utc)


def now_iso():
    return now().replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def ytdlp_json(url):
    command = [
        "yt-dlp",
        "--dump-single-json",
        "--skip-download",
        "--no-warnings",
        "--no-playlist",
        url,
    ]

    try:
        result = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=75,
        )
    except subprocess.TimeoutExpired:
        return None, "yt-dlp timed out"

    if result.returncode != 0:
        error = (result.stderr or result.stdout or "").strip()
        return None, error[-800:] if error else "yt-dlp failed"

    try:
        return json.loads(result.stdout), ""
    except json.JSONDecodeError:
        return None, "yt-dlp returned invalid JSON"


def is_live(info):
    if not isinstance(info, dict):
        return False
    return info.get("is_live") is True or info.get("live_status") == "is_live"


def normalize_channel_url(url):
    if not url:
        return None

    normalized = url.rstrip("/")
    for suffix in ("/streams", "/live"):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)]
    return normalized


def resolve_source(promotion, previous_source):
    channel_id = promotion.get("channel_id") or previous_source.get("channel_id")
    channel_name = (
        previous_source.get("channel_name")
        or promotion.get("short_name")
        or promotion["name"]
    )
    channel_url = normalize_channel_url(
        promotion.get("channel_url") or previous_source.get("channel_url")
    )

    if channel_id and not channel_url:
        channel_url = f"https://www.youtube.com/channel/{channel_id}"

    if not channel_url:
        return (
            channel_id,
            channel_name,
            None,
            "No direct YouTube channel URL configured",
        )

    return channel_id, channel_name, channel_url, ""


def title_allowed(title, global_terms, promotion):
    lowered = (title or "").casefold()
    terms = list(global_terms) + list(promotion.get("ignore_terms") or [])
    return not any(str(term).casefold() in lowered for term in terms)


def prior_event_for(promotion_id, previous_state):
    for event in previous_state.get("events") or []:
        if event.get("promotion_id") == promotion_id:
            return event
    return None


def promotion_bucket(promotion_id):
    return zlib.crc32(promotion_id.encode("utf-8")) % IDLE_BATCH_COUNT


def current_bucket():
    return int(now().timestamp() // 300) % IDLE_BATCH_COUNT


def should_probe(promotion, previous_source, previous_event, active_bucket):
    if not previous_source:
        return True

    if previous_event and previous_event.get("is_live"):
        return True

    status = previous_source.get("status")
    error_count = int(previous_source.get("error_count") or 0)

    if status in {"live", "restricted_live"}:
        return True

    if status == "error" and error_count < 3:
        return True

    return promotion_bucket(promotion["id"]) == active_bucket


def build_source(
    promotion,
    channel_id,
    channel_name,
    channel_url,
    status,
    last_error,
    error_count,
    last_success_at=None,
    last_checked_at=None,
):
    return {
        "promotion": promotion["name"],
        "short_name": promotion.get("short_name") or promotion["name"],
        "country": promotion.get("country") or "International",
        "priority": int(promotion.get("priority") or 50),
        "coverage_note": promotion.get("coverage_note"),
        "access_note": promotion.get("access_note"),
        "channel_id": channel_id,
        "channel_name": channel_name,
        "channel_url": channel_url,
        "status": status,
        "last_error": last_error,
        "error_count": error_count,
        "last_success_at": last_success_at,
        "last_checked_at": last_checked_at,
    }


def probe_error_result(
    promotion,
    previous_source,
    previous_event,
    channel_id,
    channel_name,
    channel_url,
    error,
):
    error_count = int(previous_source.get("error_count") or 0) + 1
    prior_success = previous_source.get("last_success_at")
    preserved_event = None

    if previous_event and previous_event.get("is_live") and error_count <= MAX_STALE_ERRORS:
        preserved_event = dict(previous_event)
        preserved_event["stale"] = True

    source = build_source(
        promotion,
        channel_id or previous_source.get("channel_id"),
        channel_name or previous_source.get("channel_name"),
        channel_url or previous_source.get("channel_url"),
        "error",
        str(error)[-800:],
        error_count,
        prior_success,
        now_iso(),
    )

    return {"source": source, "event": preserved_event}


def probe_promotion(promotion, global_terms, previous_state):
    promotion_id = promotion["id"]
    previous_source = (previous_state.get("sources") or {}).get(promotion_id) or {}
    previous_event = prior_event_for(promotion_id, previous_state)

    channel_id, channel_name, channel_url, resolve_error = resolve_source(
        promotion,
        previous_source,
    )

    if resolve_error:
        return probe_error_result(
            promotion,
            previous_source,
            previous_event,
            channel_id,
            channel_name,
            channel_url,
            resolve_error,
        )

    live_info, live_error = ytdlp_json(f"{channel_url}/live")
    checked_at = now_iso()

    if not live_info:
        error_text = (live_error or "").casefold()
        known_offline_markers = (
            "not currently live",
            "no live stream",
            "this live event will begin",
            "premieres in",
            "upcoming",
            "video unavailable",
        )

        if any(marker in error_text for marker in known_offline_markers):
            return {
                "source": build_source(
                    promotion,
                    channel_id,
                    channel_name,
                    channel_url,
                    "offline",
                    None,
                    0,
                    previous_source.get("last_success_at"),
                    checked_at,
                ),
                "event": None,
            }

        return probe_error_result(
            promotion,
            previous_source,
            previous_event,
            channel_id,
            channel_name,
            channel_url,
            live_error or "Could not inspect channel live route",
        )

    channel_id = live_info.get("channel_id") or channel_id
    channel_name = live_info.get("channel") or live_info.get("uploader") or channel_name

    if channel_id:
        channel_url = f"https://www.youtube.com/channel/{channel_id}"

    if not is_live(live_info):
        return {
            "source": build_source(
                promotion,
                channel_id,
                channel_name,
                channel_url,
                live_info.get("live_status") or "offline",
                None,
                0,
                previous_source.get("last_success_at"),
                checked_at,
            ),
            "event": None,
        }

    availability = live_info.get("availability")
    if availability in RESTRICTED_AVAILABILITY:
        return {
            "source": build_source(
                promotion,
                channel_id,
                channel_name,
                channel_url,
                "restricted_live",
                f"YouTube availability: {availability}",
                0,
                previous_source.get("last_success_at"),
                checked_at,
            ),
            "event": None,
        }

    title = live_info.get("title") or f"{promotion.get('short_name') or promotion['name']} live"
    if not title_allowed(title, global_terms, promotion):
        return {
            "source": build_source(
                promotion,
                channel_id,
                channel_name,
                channel_url,
                "ignored_live",
                None,
                0,
                previous_source.get("last_success_at"),
                checked_at,
            ),
            "event": None,
        }

    video_id = live_info.get("id")
    if not video_id:
        return probe_error_result(
            promotion,
            previous_source,
            previous_event,
            channel_id,
            channel_name,
            channel_url,
            "Live video did not expose a video ID",
        )

    observed_at = now_iso()
    event = {
        "event_id": f"{promotion_id}:{video_id}",
        "promotion_id": promotion_id,
        "promotion": promotion["name"],
        "short_name": promotion.get("short_name") or promotion["name"],
        "country": promotion.get("country") or "International",
        "priority": int(promotion.get("priority") or 50),
        "coverage_note": promotion.get("coverage_note"),
        "access_note": promotion.get("access_note"),
        "channel_name": channel_name,
        "channel_id": channel_id,
        "channel_url": channel_url,
        "video_id": video_id,
        "title": title,
        "watch_url": live_info.get("webpage_url")
        or f"https://www.youtube.com/watch?v={video_id}",
        "is_live": True,
        "stale": False,
        "observed_at": observed_at,
    }

    return {
        "source": build_source(
            promotion,
            channel_id,
            channel_name,
            channel_url,
            "live",
            None,
            0,
            observed_at,
            checked_at,
        ),
        "event": event,
    }


def comparable(state):
    clean = json.loads(json.dumps(state))
    clean.pop("generated_at", None)

    for source in (clean.get("sources") or {}).values():
        source.pop("last_success_at", None)
        source.pop("last_checked_at", None)

    for event in clean.get("events") or []:
        event.pop("observed_at", None)

    return clean


def main():
    registry = load_json(REGISTRY_PATH, {})
    previous = load_json(STATE_PATH, {})
    promotions = [
        promotion
        for promotion in registry.get("promotions") or []
        if promotion.get("enabled", True)
    ]
    global_terms = registry.get("global_ignore_terms") or []

    if not promotions:
        print("No enabled live promotions are configured.", file=sys.stderr)
        return 1

    active_bucket = current_bucket()
    sources = {}
    events = []
    to_probe = []

    for promotion in promotions:
        previous_source = (previous.get("sources") or {}).get(promotion["id"]) or {}
        previous_event = prior_event_for(promotion["id"], previous)

        if should_probe(promotion, previous_source, previous_event, active_bucket):
            to_probe.append(promotion)
            continue

        if previous_source:
            sources[promotion["id"]] = previous_source

    with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, max(1, len(to_probe)))) as pool:
        jobs = {
            pool.submit(probe_promotion, promotion, global_terms, previous): promotion
            for promotion in to_probe
        }

        for future in as_completed(jobs):
            promotion = jobs[future]
            try:
                result = future.result()
            except Exception as exc:
                result = probe_error_result(
                    promotion,
                    (previous.get("sources") or {}).get(promotion["id"]) or {},
                    prior_event_for(promotion["id"], previous),
                    None,
                    promotion.get("short_name") or promotion["name"],
                    promotion.get("channel_url"),
                    f"Unhandled monitor error: {exc}",
                )

            sources[promotion["id"]] = result["source"]
            if result.get("event"):
                events.append(result["event"])

    # Any live event must come from a promotion probed on this run. A prior live
    # event is always forced into to_probe, so it cannot linger indefinitely.
    events.sort(
        key=lambda event: (
            -int(event.get("priority") or 0),
            str(event.get("promotion") or ""),
            str(event.get("title") or ""),
        )
    )

    selected_event_id = events[0]["event_id"] if events else None
    state = {
        "version": 3,
        "generated_at": now_iso(),
        "selected_event_id": selected_event_id,
        "events": events,
        "sources": dict(sorted(sources.items())),
        "monitored_count": len(promotions),
        "live_count": len(events),
    }

    if comparable(state) == comparable(previous):
        print(
            f"Global live state unchanged: {len(events)} live / "
            f"{len(promotions)} monitored / {len(to_probe)} checked."
        )
        return 0

    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps(state, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(
        f"Updated global live state: {len(events)} live / "
        f"{len(promotions)} monitored / {len(to_probe)} checked."
    )

    for event in events:
        stale = " (stale)" if event.get("stale") else ""
        print(f"- {event['short_name']}: {event['title']}{stale}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
