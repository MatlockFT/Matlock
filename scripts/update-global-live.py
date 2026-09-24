#!/usr/bin/env python3
import html
import json
import re
import sys
import urllib.error
import urllib.request
import urllib.parse
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "assets" / "data" / "live-promotions.json"
STATE_PATH = ROOT / "assets" / "data" / "global-live.json"

MAX_STALE_ERRORS = 4
MAX_WORKERS = 6
IDLE_BATCH_COUNT = 3
MAX_STREAM_CANDIDATES = 6

VIDEO_ID_RE = re.compile(r'"videoId":"([A-Za-z0-9_-]{11})"')
STREAM_VIDEO_ID_RE = re.compile(
    r'"(?:videoRenderer|gridVideoRenderer)":\{"videoId":"([A-Za-z0-9_-]{11})"'
)
LIVE_BROADCAST_RE = re.compile(
    r'"liveBroadcastDetails":\\{.{0,1500}?"isLiveNow":true',
    re.S,
)
WATCH_URL_RE = re.compile(r'(?:watch\\?v=|watch%3Fv%3D)([A-Za-z0-9_-]{11})')
OG_TITLE_RE = re.compile(r'<meta property="og:title" content="([^"]+)"', re.I)
TITLE_RUN_RE = re.compile(
    r'"title":\{"runs":\[\{"text":"((?:\\.|[^"\\])*)"',
    re.S,
)
TITLE_SIMPLE_RE = re.compile(
    r'"title":\{"simpleText":"((?:\\.|[^"\\])*)"',
    re.S,
)
TITLE_CONTENT_RE = re.compile(
    r'"title":\{"content":"((?:\\.|[^"\\])*)"',
    re.S,
)
WATCHING_RE = re.compile(r'"content":"[^"]*\bwatching"', re.I)

LIVE_MARKERS = (
    '"BADGE_STYLE_TYPE_LIVE_NOW"',
    '"style":"LIVE"',
    '"isLiveNow":true',
    '"text":"LIVE"',
)

RESTRICTED_MARKERS = (
    "BADGE_STYLE_TYPE_MEMBERS_ONLY",
    "members-only",
    "members only",
    "subscriber-only",
)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/153.0.0.0 Safari/537.36"
)


def utc_now():
    return datetime.now(timezone.utc)


def now_iso():
    return utc_now().replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def normalize_channel_url(url):
    if not url:
        return None

    normalized = url.rstrip("/")
    for suffix in ("/streams", "/live"):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)]
    return normalized


def fetch_text(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml",
            "Cache-Control": "no-cache",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=35) as response:
            content_type = response.headers.get("Content-Type", "")
            final_url = response.geturl()
            body = response.read().decode("utf-8", errors="replace")
            if response.status >= 400:
                return None, f"HTTP {response.status}", final_url
            if "text/html" not in content_type and "<html" not in body[:500].lower():
                return None, f"Unexpected content type: {content_type}", final_url
            return body, "", final_url
    except urllib.error.HTTPError as exc:
        return None, f"HTTP {exc.code}: {exc.reason}", exc.geturl()
    except urllib.error.URLError as exc:
        return None, f"Network error: {exc.reason}", url
    except TimeoutError:
        return None, "Request timed out", url
    except Exception as exc:
        return None, f"Request error: {exc}", url


def decode_json_text(value):
    if not value:
        return ""

    try:
        decoded = json.loads(f'"{value}"')
    except json.JSONDecodeError:
        decoded = value.replace(r'\"', '"').replace(r"\\n", " ")

    return html.unescape(decoded).strip()


def extract_title(window, fallback):
    content_match = TITLE_CONTENT_RE.search(window)
    if content_match:
        title = decode_json_text(content_match.group(1))
        if title:
            return title

    og_match = OG_TITLE_RE.search(window)
    if og_match:
        title = html.unescape(og_match.group(1)).strip()
        if title:
            return title

    run_match = TITLE_RUN_RE.search(window)
    if run_match:
        title = decode_json_text(run_match.group(1))
        if title:
            return title

    simple_match = TITLE_SIMPLE_RE.search(window)
    if simple_match:
        title = decode_json_text(simple_match.group(1))
        if title:
            return title

    return fallback


def video_id_from_url(url):
    if not url:
        return None
    match = WATCH_URL_RE.search(url)
    return match.group(1) if match else None


def fetch_oembed(video_id):
    params = urllib.parse.urlencode({
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "format": "json",
    })
    request = urllib.request.Request(
        f"https://www.youtube.com/oembed?{params}",
        headers={
            "User-Agent": USER_AGENT,
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            payload = json.loads(response.read().decode("utf-8", errors="replace"))
            return payload, ""
    except urllib.error.HTTPError as exc:
        return None, f"HTTP {exc.code}: {exc.reason}"
    except Exception as exc:
        return None, f"oEmbed error: {exc}"


def find_live_video(page_html, promotion):
    candidates = []
    seen = set()

    for match in VIDEO_ID_RE.finditer(page_html):
        video_id = match.group(1)
        if video_id in seen:
            continue
        seen.add(video_id)

        start = max(0, match.start() - 1200)
        end = min(len(page_html), match.end() + 9000)
        window = page_html[start:end]
        lowered = window.casefold()

        if not any(marker in window for marker in LIVE_MARKERS):
            continue

        if any(marker in lowered for marker in RESTRICTED_MARKERS):
            candidates.append(
                {
                    "video_id": video_id,
                    "restricted": True,
                    "title": extract_title(
                        window,
                        f"{promotion.get('short_name') or promotion['name']} live",
                    ),
                }
            )
            continue

        candidates.append(
            {
                "video_id": video_id,
                "restricted": False,
                "title": extract_title(
                    window,
                    f"{promotion.get('short_name') or promotion['name']} live",
                ),
            }
        )

    # Prefer a public live candidate if both public and restricted broadcasts
    # appear on the Streams page.
    candidates.sort(key=lambda item: item["restricted"])
    return candidates[0] if candidates else None


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
    return int(utc_now().timestamp() // 300) % IDLE_BATCH_COUNT


def should_probe(promotion, previous_source, previous_event, active_bucket):
    if promotion.get("always_check"):
        return True

    if not previous_source:
        return True

    if previous_event and previous_event.get("is_live"):
        return True

    status = previous_source.get("status")
    error_count = int(previous_source.get("error_count") or 0)

    if status in {"live", "restricted_live"}:
        return True

    if status == "error" and error_count < 2:
        return True

    return promotion_bucket(promotion["id"]) == active_bucket


def build_source(
    promotion,
    channel_url,
    status,
    last_error=None,
    error_count=0,
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
        "channel_url": channel_url,
        "status": status,
        "last_error": last_error,
        "error_count": error_count,
        "last_success_at": last_success_at,
        "last_checked_at": last_checked_at,
    }


def error_result(promotion, previous_source, previous_event, channel_url, error):
    error_count = int(previous_source.get("error_count") or 0) + 1
    preserved_event = None

    if previous_event and previous_event.get("is_live") and error_count <= MAX_STALE_ERRORS:
        preserved_event = dict(previous_event)
        preserved_event["stale"] = True

    return {
        "source": build_source(
            promotion,
            channel_url or previous_source.get("channel_url"),
            "error",
            str(error)[-800:],
            error_count,
            previous_source.get("last_success_at"),
            now_iso(),
        ),
        "event": preserved_event,
    }


def extract_stream_candidates(page_html, promotion):
    candidates = []
    seen = set()

    matches = list(STREAM_VIDEO_ID_RE.finditer(page_html))
    if not matches:
        matches = list(VIDEO_ID_RE.finditer(page_html))

    for match in matches:
        video_id = match.group(1)
        if video_id in seen:
            continue
        seen.add(video_id)

        window_start = max(0, match.start() - 700)
        window_end = min(len(page_html), match.end() + 9000)
        window = page_html[window_start:window_end]
        lowered = window.casefold()

        live = (
            bool(WATCHING_RE.search(window))
            or "BADGE_STYLE_TYPE_LIVE_NOW" in window
            or '"style":"LIVE"' in window
            or '"label":"LIVE"' in window
        )
        restricted = any(marker in lowered for marker in RESTRICTED_MARKERS)
        title = extract_title(
            window,
            f"{promotion.get('short_name') or promotion['name']} live",
        )

        candidates.append(
            {
                "video_id": video_id,
                "title": title,
                "live": live,
                "restricted": restricted,
            }
        )

        if len(candidates) >= MAX_STREAM_CANDIDATES:
            break

    return candidates


def probe_promotion(promotion, global_terms, previous_state):
    promotion_id = promotion["id"]
    previous_source = (previous_state.get("sources") or {}).get(promotion_id) or {}
    previous_event = prior_event_for(promotion_id, previous_state)

    channel_url = normalize_channel_url(promotion.get("channel_url"))
    if not channel_url:
        return error_result(
            promotion,
            previous_source,
            previous_event,
            None,
            "No direct YouTube channel URL configured",
        )

    checked_at = now_iso()
    streams_page, streams_error, _ = fetch_text(f"{channel_url}/streams")
    if not streams_page:
        return error_result(
            promotion,
            previous_source,
            previous_event,
            channel_url,
            streams_error or "Could not load YouTube Streams page",
        )

    candidates = extract_stream_candidates(streams_page, promotion)

    if promotion_id == "inka":
        print(
            "INKA stream candidates:",
            [
                {
                    "video_id": item["video_id"],
                    "title": item["title"],
                    "live": item["live"],
                    "restricted": item["restricted"],
                }
                for item in candidates
            ],
        )

    restricted_title = None
    ignored_title = None

    for candidate in candidates:
        if not candidate["live"]:
            continue

        title = candidate["title"]

        if candidate["restricted"]:
            restricted_title = title
            continue

        if not title_allowed(title, global_terms, promotion):
            ignored_title = title
            continue

        video_id = candidate["video_id"]
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
            "channel_url": channel_url,
            "video_id": video_id,
            "title": title,
            "watch_url": f"https://www.youtube.com/watch?v={video_id}",
            "is_live": True,
            "stale": False,
            "observed_at": observed_at,
        }

        return {
            "source": build_source(
                promotion,
                channel_url,
                "live",
                None,
                0,
                observed_at,
                checked_at,
            ),
            "event": event,
        }

    if restricted_title:
        return {
            "source": build_source(
                promotion,
                channel_url,
                "restricted_live",
                f"Restricted live broadcast: {restricted_title}",
                0,
                previous_source.get("last_success_at"),
                checked_at,
            ),
            "event": None,
        }

    if ignored_title:
        return {
            "source": build_source(
                promotion,
                channel_url,
                "ignored_live",
                f"Ignored live title: {ignored_title}",
                0,
                previous_source.get("last_success_at"),
                checked_at,
            ),
            "event": None,
        }

    return {
        "source": build_source(
            promotion,
            channel_url,
            "offline",
            None,
            0,
            previous_source.get("last_success_at"),
            checked_at,
        ),
        "event": None,
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
        elif previous_source:
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
                result = error_result(
                    promotion,
                    (previous.get("sources") or {}).get(promotion["id"]) or {},
                    prior_event_for(promotion["id"], previous),
                    normalize_channel_url(promotion.get("channel_url")),
                    f"Unhandled monitor error: {exc}",
                )

            sources[promotion["id"]] = result["source"]
            if result.get("event"):
                events.append(result["event"])

    events.sort(
        key=lambda event: (
            -int(event.get("priority") or 0),
            str(event.get("promotion") or ""),
            str(event.get("title") or ""),
        )
    )

    selected_event_id = events[0]["event_id"] if events else None
    state = {
        "version": 4,
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
