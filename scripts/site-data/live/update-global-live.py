#!/usr/bin/env python3
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
REGISTRY_PATH = ROOT / "assets" / "data" / "live-promotions.json"
STATE_PATH = ROOT / "assets" / "data" / "global-live.json"

YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "").strip()

MAX_STALE_ERRORS = 4
MAX_WORKERS = 6
IDLE_BATCH_COUNT = 3
MAX_STREAM_CANDIDATES = 8

VIDEO_ID_RE = re.compile(r'"videoId":"([A-Za-z0-9_-]{11})"')
STREAM_VIDEO_ID_RE = re.compile(
    r'"(?:videoRenderer|gridVideoRenderer)":\{"videoId":"([A-Za-z0-9_-]{11})"'
)
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

RESTRICTED_MARKERS = (
    "badge_style_type_members_only",
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


def fetch_json(url):
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8", errors="replace")), ""
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            payload = json.loads(exc.read().decode("utf-8", errors="replace"))
            detail = (
                payload.get("error", {}).get("message")
                or payload.get("error", {}).get("errors", [{}])[0].get("reason")
                or ""
            )
        except Exception:
            pass
        suffix = f": {detail}" if detail else ""
        return None, f"HTTP {exc.code}{suffix}"
    except urllib.error.URLError as exc:
        return None, f"Network error: {exc.reason}"
    except TimeoutError:
        return None, "Request timed out"
    except Exception as exc:
        return None, f"Request error: {exc}"


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


def title_allowed(title, global_terms, promotion):
    lowered = (title or "").casefold()
    terms = list(global_terms) + list(promotion.get("ignore_terms") or [])
    return not any(str(term).casefold() in lowered for term in terms)


def prior_event_for(promotion_id, previous_state):
    for event in previous_state.get("events") or []:
        if event.get("promotion_id") == promotion_id:
            return event
    return None


def prior_upcoming_for(promotion_id, previous_state):
    return [
        event
        for event in previous_state.get("upcoming") or []
        if event.get("promotion_id") == promotion_id
    ]


def promotion_bucket(promotion_id):
    return zlib.crc32(promotion_id.encode("utf-8")) % IDLE_BATCH_COUNT


def current_bucket():
    return int(utc_now().timestamp() // 300) % IDLE_BATCH_COUNT


def upcoming_near_start(upcoming_events):
    current = utc_now()
    for event in upcoming_events or []:
        value = event.get("scheduled_start_time")
        if not value:
            continue
        try:
            scheduled = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            continue

        seconds = (scheduled - current).total_seconds()
        if -6 * 3600 <= seconds <= 2 * 3600:
            return True

    return False


def fast_check_window_active(promotion):
    value = promotion.get("fast_check_until")
    if not value:
        return False
    try:
        until = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return False
    return utc_now() <= until


def should_probe(promotion, previous_source, previous_event, previous_upcoming, active_bucket):
    if fast_check_window_active(promotion):
        return True

    if not previous_source:
        return True

    if previous_event and previous_event.get("is_live"):
        return True

    if upcoming_near_start(previous_upcoming):
        return True

    status = previous_source.get("status")
    error_count = int(previous_source.get("error_count") or 0)

    if status in {"live", "restricted_live", "unembeddable_live"}:
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
    verification=None,
    channel_id=None,
    channel_name=None,
):
    return {
        "promotion": promotion["name"],
        "short_name": promotion.get("short_name") or promotion["name"],
        "country": promotion.get("country") or "International",
        "priority": int(promotion.get("priority") or 50),
        "coverage_note": promotion.get("coverage_note"),
        "access_note": promotion.get("access_note"),
        "channel_url": channel_url,
        "channel_id": channel_id,
        "channel_name": channel_name,
        "status": status,
        "verification": verification,
        "last_error": last_error,
        "error_count": error_count,
        "last_success_at": last_success_at,
        "last_checked_at": last_checked_at,
    }


def error_result(promotion, previous_source, previous_event, previous_state, channel_url, error):
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
            previous_source.get("verification"),
            previous_source.get("channel_id"),
            previous_source.get("channel_name"),
        ),
        "event": preserved_event,
        "upcoming": prior_upcoming_for(promotion["id"], previous_state),
    }


def promotion_channels(promotion):
    channels = []

    primary = normalize_channel_url(promotion.get("channel_url"))
    if primary:
        channels.append({
            "channel_url": primary,
            "require_terms": [],
            "role": "promotion",
        })

    for item in promotion.get("broadcast_channels") or []:
        if isinstance(item, str):
            url = normalize_channel_url(item)
            require_terms = []
            role = "broadcast_partner"
        else:
            url = normalize_channel_url(item.get("channel_url"))
            require_terms = item.get("require_terms") or []
            role = item.get("role") or "broadcast_partner"

        if not url:
            continue

        if any(existing["channel_url"] == url for existing in channels):
            continue

        channels.append({
            "channel_url": url,
            "require_terms": [str(term) for term in require_terms if str(term).strip()],
            "role": role,
        })

    return channels


def source_title_allowed(title, candidate):
    terms = candidate.get("require_terms") or []
    if not terms:
        return True

    lowered = (title or "").casefold()
    return any(term.casefold() in lowered for term in terms)


def configured_video_candidates(promotion, channel_url):
    candidates = []

    for item in promotion.get("pinned_videos") or []:
        if isinstance(item, str):
            video_id = item.strip()
            title = f"{promotion.get('short_name') or promotion['name']} live"
            source_channel_url = channel_url
            source_role = "promotion"
        else:
            video_id = str(item.get("video_id") or "").strip()
            title = str(
                item.get("title")
                or f"{promotion.get('short_name') or promotion['name']} live"
            ).strip()
            source_channel_url = (
                normalize_channel_url(item.get("channel_url")) or channel_url
            )
            source_role = str(
                item.get("source_role") or item.get("role") or "promotion"
            ).strip()

        if not re.fullmatch(r"[A-Za-z0-9_-]{11}", video_id):
            continue

        candidates.append(
            {
                "video_id": video_id,
                "title": title,
                "html_live": False,
                "restricted": False,
                "source_channel_url": source_channel_url,
                "source_role": source_role,
                "require_terms": [],
            }
        )

    return candidates


def extract_stream_candidates(page_html, promotion, channel_config):
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

        html_live = (
            bool(WATCHING_RE.search(window))
            or "badge_style_type_live_now" in lowered
            or '"style":"live"' in lowered
            or '"label":"live"' in lowered
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
                "html_live": html_live,
                "restricted": restricted,
                "source_channel_url": channel_config["channel_url"],
                "source_role": channel_config.get("role") or "promotion",
                "require_terms": channel_config.get("require_terms") or [],
            }
        )

        if len(candidates) >= MAX_STREAM_CANDIDATES:
            break

    return candidates


def youtube_videos(video_ids):
    if not YOUTUBE_API_KEY:
        return {}, "YouTube API key is not configured"

    unique_ids = []
    seen = set()
    for video_id in video_ids:
        if video_id and video_id not in seen:
            seen.add(video_id)
            unique_ids.append(video_id)

    if not unique_ids:
        return {}, ""

    params = urllib.parse.urlencode(
        {
            "part": "snippet,liveStreamingDetails,status",
            "id": ",".join(unique_ids[:50]),
            "key": YOUTUBE_API_KEY,
        }
    )
    payload, error = fetch_json(
        f"https://www.googleapis.com/youtube/v3/videos?{params}"
    )
    if not payload:
        return {}, error

    items = {}
    for item in payload.get("items") or []:
        video_id = item.get("id")
        if video_id:
            items[video_id] = item

    return items, ""


def classify_api_video(item):
    snippet = item.get("snippet") or {}
    live_details = item.get("liveStreamingDetails") or {}
    broadcast_content = snippet.get("liveBroadcastContent") or "none"

    actual_start = live_details.get("actualStartTime")
    actual_end = live_details.get("actualEndTime")
    scheduled_start = live_details.get("scheduledStartTime")

    # End-state metadata is authoritative. YouTube can briefly leave
    # liveBroadcastContent="live" while an ended broadcast is transitioning
    # into its archived replay.
    if actual_end:
        return "ended"

    if broadcast_content == "live":
        return "live"

    if broadcast_content == "upcoming":
        return "upcoming"

    if scheduled_start and not actual_start:
        return "upcoming"

    return "offline"


def make_event(promotion, channel_url, video_id, title, item, event_status):
    snippet = item.get("snippet") or {}
    live_details = item.get("liveStreamingDetails") or {}
    status = item.get("status") or {}

    return {
        "event_id": f"{promotion['id']}:{video_id}",
        "promotion_id": promotion["id"],
        "promotion": promotion["name"],
        "short_name": promotion.get("short_name") or promotion["name"],
        "country": promotion.get("country") or "International",
        "priority": int(promotion.get("priority") or 50),
        "coverage_note": promotion.get("coverage_note"),
        "access_note": promotion.get("access_note"),
        "channel_url": channel_url,
        "channel_id": snippet.get("channelId"),
        "channel_name": snippet.get("channelTitle"),
        "video_id": video_id,
        "title": title,
        "watch_url": f"https://www.youtube.com/watch?v={video_id}",
        "status": event_status,
        "is_live": event_status == "live",
        "embeddable": status.get("embeddable", True),
        "scheduled_start_time": live_details.get("scheduledStartTime"),
        "scheduled_end_time": live_details.get("scheduledEndTime"),
        "actual_start_time": live_details.get("actualStartTime"),
        "actual_end_time": live_details.get("actualEndTime"),
        "concurrent_viewers": live_details.get("concurrentViewers"),
        "api_verified": True,
        "stale": False,
        "observed_at": now_iso(),
    }


def probe_promotion(promotion, global_terms, previous_state):
    promotion_id = promotion["id"]
    previous_source = (previous_state.get("sources") or {}).get(promotion_id) or {}
    previous_event = prior_event_for(promotion_id, previous_state)

    channel_configs = promotion_channels(promotion)
    primary_channel_url = (
        channel_configs[0]["channel_url"]
        if channel_configs
        else normalize_channel_url(promotion.get("channel_url"))
    )

    if not channel_configs:
        return error_result(
            promotion,
            previous_source,
            previous_event,
            previous_state,
            None,
            "No YouTube channel URL configured",
        )

    checked_at = now_iso()
    candidates = []
    fetch_errors = []
    seen_video_ids = set()

    for channel_config in channel_configs:
        channel_url = channel_config["channel_url"]
        streams_page, streams_error, _ = fetch_text(f"{channel_url}/streams")
        if not streams_page:
            fetch_errors.append(f"{channel_url}: {streams_error or 'Could not load Streams page'}")
            continue

        for candidate in extract_stream_candidates(
            streams_page,
            promotion,
            channel_config,
        ):
            video_id = candidate.get("video_id")
            if not video_id or video_id in seen_video_ids:
                continue
            seen_video_ids.add(video_id)
            candidates.append(candidate)

    for candidate in configured_video_candidates(promotion, primary_channel_url):
        video_id = candidate.get("video_id")
        if not video_id or video_id in seen_video_ids:
            continue
        seen_video_ids.add(video_id)
        candidates.append(candidate)

    if not candidates and len(fetch_errors) == len(channel_configs):
        return error_result(
            promotion,
            previous_source,
            previous_event,
            previous_state,
            primary_channel_url,
            " | ".join(fetch_errors)[:800],
        )

    api_items, api_error = youtube_videos(
        [candidate["video_id"] for candidate in candidates]
    )

    if api_items:
        live_events = []
        upcoming = []
        restricted_title = None
        unembeddable_title = None
        ignored_title = None
        api_channel_id = None
        api_channel_name = None

        for candidate in candidates:
            video_id = candidate["video_id"]
            item = api_items.get(video_id)
            if not item:
                continue

            snippet = item.get("snippet") or {}
            status_data = item.get("status") or {}
            api_channel_id = api_channel_id or snippet.get("channelId")
            api_channel_name = api_channel_name or snippet.get("channelTitle")

            title = (snippet.get("title") or candidate["title"] or "").strip()
            event_status = classify_api_video(item)

            if event_status not in {"live", "upcoming"}:
                continue

            if not source_title_allowed(title, candidate):
                continue

            if candidate["restricted"]:
                restricted_title = title
                continue

            if not title_allowed(title, global_terms, promotion):
                ignored_title = title
                continue

            event = make_event(
                promotion,
                candidate.get("source_channel_url") or primary_channel_url,
                video_id,
                title,
                item,
                event_status,
            )
            event["source_role"] = candidate.get("source_role") or "promotion"

            if event_status == "live":
                if not status_data.get("embeddable", True):
                    unembeddable_title = title
                    continue
                live_events.append(event)
            else:
                upcoming.append(event)

        upcoming.sort(
            key=lambda event: (
                event.get("scheduled_start_time") or "9999-12-31T23:59:59Z",
                -int(event.get("priority") or 0),
                event.get("title") or "",
            )
        )

        if live_events:
            observed_at = now_iso()
            for live_event in live_events:
                live_event["observed_at"] = observed_at
            primary_live_event = live_events[0]
            return {
                "source": build_source(
                    promotion,
                    primary_live_event.get("channel_url") or primary_channel_url,
                    "live",
                    None,
                    0,
                    observed_at,
                    checked_at,
                    "youtube_api",
                    primary_live_event.get("channel_id") or api_channel_id,
                    primary_live_event.get("channel_name") or api_channel_name,
                ),
                "event": primary_live_event,
                "events": live_events,
                "upcoming": upcoming,
            }

        if unembeddable_title:
            source_status = "unembeddable_live"
            source_error = f"Live broadcast cannot be embedded: {unembeddable_title}"
        elif restricted_title:
            source_status = "restricted_live"
            source_error = f"Restricted live broadcast: {restricted_title}"
        elif ignored_title:
            source_status = "ignored_live"
            source_error = f"Ignored live title: {ignored_title}"
        else:
            source_status = "upcoming" if upcoming else "offline"
            source_error = None

        best_channel_url = (
            upcoming[0].get("channel_url")
            if upcoming
            else primary_channel_url
        )

        return {
            "source": build_source(
                promotion,
                best_channel_url,
                source_status,
                source_error,
                0,
                previous_source.get("last_success_at"),
                checked_at,
                "youtube_api",
                api_channel_id,
                api_channel_name,
            ),
            "event": None,
            "upcoming": upcoming,
        }

    # API failure falls back to public channel-card live metadata.
    restricted_title = None
    ignored_title = None

    for candidate in candidates:
        if not candidate["html_live"]:
            continue

        title = candidate["title"]

        if not source_title_allowed(title, candidate):
            continue

        if candidate["restricted"]:
            restricted_title = title
            continue

        if not title_allowed(title, global_terms, promotion):
            ignored_title = title
            continue

        observed_at = now_iso()
        source_channel_url = (
            candidate.get("source_channel_url") or primary_channel_url
        )
        event = {
            "event_id": f"{promotion_id}:{candidate['video_id']}",
            "promotion_id": promotion_id,
            "promotion": promotion["name"],
            "short_name": promotion.get("short_name") or promotion["name"],
            "country": promotion.get("country") or "International",
            "priority": int(promotion.get("priority") or 50),
            "coverage_note": promotion.get("coverage_note"),
            "access_note": promotion.get("access_note"),
            "channel_url": source_channel_url,
            "channel_id": previous_source.get("channel_id"),
            "channel_name": previous_source.get("channel_name"),
            "video_id": candidate["video_id"],
            "title": title,
            "watch_url": f"https://www.youtube.com/watch?v={candidate['video_id']}",
            "status": "live",
            "is_live": True,
            "embeddable": True,
            "scheduled_start_time": None,
            "scheduled_end_time": None,
            "actual_start_time": None,
            "actual_end_time": None,
            "concurrent_viewers": None,
            "api_verified": False,
            "source_role": candidate.get("source_role") or "promotion",
            "stale": False,
            "observed_at": observed_at,
        }

        return {
            "source": build_source(
                promotion,
                source_channel_url,
                "live",
                f"API fallback: {api_error}" if api_error else None,
                0,
                observed_at,
                checked_at,
                "html_fallback",
                previous_source.get("channel_id"),
                previous_source.get("channel_name"),
            ),
            "event": event,
            "upcoming": prior_upcoming_for(promotion_id, previous_state),
        }

    if restricted_title:
        fallback_status = "restricted_live"
        fallback_error = f"Restricted live broadcast: {restricted_title}"
    elif ignored_title:
        fallback_status = "ignored_live"
        fallback_error = f"Ignored live title: {ignored_title}"
    else:
        fallback_status = "offline"
        fallback_error = f"API fallback: {api_error}" if api_error else None

    return {
        "source": build_source(
            promotion,
            primary_channel_url,
            fallback_status,
            fallback_error,
            0,
            previous_source.get("last_success_at"),
            checked_at,
            "html_fallback",
            previous_source.get("channel_id"),
            previous_source.get("channel_name"),
        ),
        "event": None,
        "upcoming": prior_upcoming_for(promotion_id, previous_state),
    }


def comparable(state):
    clean = json.loads(json.dumps(state))
    clean.pop("generated_at", None)

    for source in (clean.get("sources") or {}).values():
        source.pop("last_success_at", None)
        source.pop("last_checked_at", None)

    for key in ("events", "upcoming"):
        for event in clean.get(key) or []:
            event.pop("observed_at", None)
            event.pop("concurrent_viewers", None)

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
    upcoming = []
    to_probe = []

    for promotion in promotions:
        previous_source = (previous.get("sources") or {}).get(promotion["id"]) or {}
        previous_event = prior_event_for(promotion["id"], previous)
        previous_upcoming = prior_upcoming_for(promotion["id"], previous)

        if should_probe(
            promotion,
            previous_source,
            previous_event,
            previous_upcoming,
            active_bucket,
        ):
            to_probe.append(promotion)
        else:
            if previous_source:
                sources[promotion["id"]] = previous_source
            upcoming.extend(prior_upcoming_for(promotion["id"], previous))

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
                    previous,
                    normalize_channel_url(promotion.get("channel_url")),
                    f"Unhandled monitor error: {exc}",
                )

            sources[promotion["id"]] = result["source"]
            result_events = result.get("events")
            if result_events is not None:
                events.extend(event for event in result_events if event)
            elif result.get("event"):
                events.append(result["event"])
            upcoming.extend(result.get("upcoming") or [])

    # Collapse mirrored live broadcasts exposed on multiple YouTube channels.
    # Keep distinct simultaneous streams from the same promotion when their titles differ.
    deduped_events = {}
    for event in events:
        title_key = re.sub(r"\\s+", " ", str(event.get("title") or "").strip()).casefold()
        event_key = (
            str(event.get("promotion_id") or ""),
            title_key or str(event.get("video_id") or ""),
        )
        current = deduped_events.get(event_key)
        if current is None:
            deduped_events[event_key] = event
            continue

        def live_event_score(item):
            role_score = 1 if item.get("source_role") == "promotion" else 0
            try:
                viewers = int(item.get("concurrent_viewers") or 0)
            except (TypeError, ValueError):
                viewers = 0
            return (role_score, viewers)

        if live_event_score(event) > live_event_score(current):
            deduped_events[event_key] = event

    events = list(deduped_events.values())

    # Remove duplicates if a channel page exposed the same scheduled stream
    # multiple times.
    deduped_upcoming = {}
    for event in upcoming:
        event_id = event.get("event_id")
        if event_id:
            deduped_upcoming[event_id] = event
    upcoming = list(deduped_upcoming.values())

    events.sort(
        key=lambda event: (
            -int(event.get("priority") or 0),
            str(event.get("promotion") or ""),
            str(event.get("title") or ""),
        )
    )
    upcoming.sort(
        key=lambda event: (
            event.get("scheduled_start_time") or "9999-12-31T23:59:59Z",
            -int(event.get("priority") or 0),
            str(event.get("title") or ""),
        )
    )

    selected_event_id = events[0]["event_id"] if events else None
    api_verified_sources = sum(
        1
        for source in sources.values()
        if source.get("verification") == "youtube_api"
    )

    state = {
        "version": 5,
        "generated_at": now_iso(),
        "selected_event_id": selected_event_id,
        "events": events,
        "upcoming": upcoming[:40],
        "sources": dict(sorted(sources.items())),
        "monitored_count": len(promotions),
        "live_count": len(events),
        "upcoming_count": len(upcoming),
        "youtube_api_configured": bool(YOUTUBE_API_KEY),
        "api_verified_source_count": api_verified_sources,
    }

    if comparable(state) == comparable(previous):
        print(
            f"Global live state unchanged: {len(events)} live / "
            f"{len(upcoming)} upcoming / {len(promotions)} monitored / "
            f"{len(to_probe)} checked / {api_verified_sources} API-verified sources."
        )
        return 0

    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps(state, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(
        f"Updated global live state: {len(events)} live / "
        f"{len(upcoming)} upcoming / {len(promotions)} monitored / "
        f"{len(to_probe)} checked / {api_verified_sources} API-verified sources."
    )

    for event in events:
        verification = "API" if event.get("api_verified") else "HTML"
        print(f"- LIVE [{verification}] {event['short_name']}: {event['title']}")

    for event in upcoming[:8]:
        print(
            f"- UPCOMING {event['short_name']}: {event['title']} "
            f"@ {event.get('scheduled_start_time') or 'time TBD'}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
