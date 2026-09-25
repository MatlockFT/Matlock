#!/usr/bin/env python3
import json
import os
import re
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
QUEUE_PATH = ROOT / "assets" / "data" / "live-source-candidates.json"
OUT_PATH = ROOT / "assets" / "data" / "live-source-discovery.json"
API_KEY = os.environ.get("YOUTUBE_API_KEY", "").strip()

STOP = {
    "mma","fc","fighting","fight","championship","championships","official",
    "promotion","league","the","of","combat","professional","pro"
}

def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00","Z")

def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default

def fetch_json(url):
    req = urllib.request.Request(
        url,
        headers={"User-Agent":"MMAMatlockLiveSourceDiscovery/1.0","Accept":"application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8", errors="replace")), ""
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            payload = json.loads(exc.read().decode("utf-8", errors="replace"))
            detail = payload.get("error",{}).get("message") or ""
        except Exception:
            pass
        return None, f"HTTP {exc.code}: {detail or exc.reason}"
    except Exception as exc:
        return None, str(exc)

def norm(value):
    value = re.sub(r"[^a-z0-9 ]+"," ",(value or "").casefold())
    return " ".join(value.split())

def tokens(value):
    return {t for t in norm(value).split() if len(t) > 2 and t not in STOP}

def score_candidate(promotion, title, description):
    pnorm = norm(promotion)
    tnorm = norm(title)
    ptokens = tokens(promotion)
    ttokens = tokens(title)
    desc_tokens = tokens(description)

    score = 0
    if pnorm and pnorm == tnorm:
        score += 100
    elif pnorm and pnorm in tnorm:
        score += 60

    overlap = len(ptokens & ttokens)
    score += overlap * 18

    desc_overlap = len(ptokens & desc_tokens)
    score += min(desc_overlap * 4, 16)

    if "official" in tnorm or "official" in norm(description):
        score += 5

    return score

def search_event_videos(channel_id, event_type):
    params = urllib.parse.urlencode({
        "part":"snippet",
        "type":"video",
        "eventType":event_type,
        "channelId":channel_id,
        "maxResults":"5",
        "order":"date",
        "key":API_KEY,
    })
    payload, error = fetch_json(f"https://www.googleapis.com/youtube/v3/search?{params}")
    if not payload:
        return [], error

    videos = []
    for item in payload.get("items") or []:
        video_id = (item.get("id") or {}).get("videoId")
        snippet = item.get("snippet") or {}
        if not video_id:
            continue
        videos.append({
            "video_id":video_id,
            "watch_url":f"https://www.youtube.com/watch?v={video_id}",
            "title":snippet.get("title") or "",
            "published_at":snippet.get("publishedAt"),
        })
    return videos, ""


def search_global_event_videos(query, event_type):
    params = urllib.parse.urlencode({
        "part":"snippet",
        "type":"video",
        "eventType":event_type,
        "maxResults":"5",
        "order":"date",
        "q":query,
        "key":API_KEY,
    })
    payload, error = fetch_json(f"https://www.googleapis.com/youtube/v3/search?{params}")
    if not payload:
        return [], error

    videos = []
    for item in payload.get("items") or []:
        video_id = (item.get("id") or {}).get("videoId")
        snippet = item.get("snippet") or {}
        if not video_id:
            continue
        videos.append({
            "video_id":video_id,
            "watch_url":f"https://www.youtube.com/watch?v={video_id}",
            "title":snippet.get("title") or "",
            "channel_title":snippet.get("channelTitle") or "",
            "channel_id":snippet.get("channelId"),
            "published_at":snippet.get("publishedAt"),
        })
    return videos, ""


def lookup_video(video_id):
    params = urllib.parse.urlencode({
        "part":"snippet",
        "id":video_id,
        "key":API_KEY,
    })
    payload, error = fetch_json(f"https://www.googleapis.com/youtube/v3/videos?{params}")
    if not payload:
        return None, error

    items = payload.get("items") or []
    if not items:
        return None, "Video not found"

    snippet = items[0].get("snippet") or {}
    channel_id = snippet.get("channelId")
    if not channel_id:
        return None, "Video has no channel ID"

    return {
        "video_id":video_id,
        "watch_url":f"https://www.youtube.com/watch?v={video_id}",
        "title":snippet.get("title") or "",
        "channel_title":snippet.get("channelTitle") or "",
        "channel_id":channel_id,
        "channel_url":f"https://www.youtube.com/channel/{channel_id}",
        "published_at":snippet.get("publishedAt"),
    }, ""


def search_channels(query):
    params = urllib.parse.urlencode({
        "part":"snippet",
        "type":"channel",
        "maxResults":"5",
        "q":query,
        "key":API_KEY,
    })
    payload, error = fetch_json(f"https://www.googleapis.com/youtube/v3/search?{params}")
    if not payload:
        return [], error

    results = []
    for item in payload.get("items") or []:
        channel_id = (item.get("id") or {}).get("channelId")
        snippet = item.get("snippet") or {}
        if not channel_id:
            continue
        results.append({
            "channel_id":channel_id,
            "channel_url":f"https://www.youtube.com/channel/{channel_id}",
            "title":snippet.get("channelTitle") or snippet.get("title") or "",
            "description":snippet.get("description") or "",
            "published_at":snippet.get("publishedAt"),
        })
    return results, ""

def main():
    if not API_KEY:
        raise SystemExit("YOUTUBE_API_KEY is not configured")

    queue = load_json(QUEUE_PATH,{})
    research = [x for x in queue.get("candidates") or [] if x.get("status") == "research"]
    output = {
        "version":1,
        "generated_at":now_iso(),
        "searched_count":len(research),
        "results":[],
    }

    for entry in research:
        query = entry.get("search_query") or entry.get("promotion") or entry.get("event")
        direct_video = None
        video_id = (entry.get("video_id") or "").strip()
        if video_id:
            direct_video, error = lookup_video(video_id)
            if direct_video:
                found = [{
                    "channel_id": direct_video["channel_id"],
                    "channel_url": direct_video["channel_url"],
                    "title": direct_video["channel_title"],
                    "description": f"Uploader of {direct_video['title']}",
                    "published_at": None,
                    "score": 1000,
                }]
            else:
                found = []
        else:
            found, error = search_channels(query)

        ranked = []
        for candidate in found:
            if "score" not in candidate:
                candidate["score"] = score_candidate(
                    entry.get("promotion") or "",
                    candidate.get("title") or "",
                    candidate.get("description") or "",
                )
            ranked.append(candidate)
        ranked.sort(key=lambda x:(-x["score"], x["title"]))

        top_live = []
        top_upcoming = []
        live_error = None
        upcoming_error = None

        if ranked and ranked[0]["score"] >= 15:
            top_live, live_error = search_event_videos(ranked[0]["channel_id"], "live")
            top_upcoming, upcoming_error = search_event_videos(ranked[0]["channel_id"], "upcoming")

        event_query = " ".join(
            part for part in [entry.get("event"), entry.get("promotion")] if part
        )
        global_live, global_live_error = search_global_event_videos(event_query, "live")
        global_upcoming, global_upcoming_error = search_global_event_videos(event_query, "upcoming")

        output["results"].append({
            "id":entry.get("id"),
            "promotion":entry.get("promotion"),
            "event":entry.get("event"),
            "query":query,
            "error":error or None,
            "direct_video":direct_video,
            "candidates":ranked,
            "top_candidate_live":top_live,
            "top_candidate_upcoming":top_upcoming,
            "top_candidate_live_error":live_error,
            "top_candidate_upcoming_error":upcoming_error,
            "event_search_live":global_live,
            "event_search_upcoming":global_upcoming,
            "event_search_live_error":global_live_error,
            "event_search_upcoming_error":global_upcoming_error,
        })

    OUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False)+"\n", encoding="utf-8")
    print(f"Searched {len(research)} unresolved promotions.")
    for item in output["results"]:
        top = (item["candidates"] or [{}])[0]
        print(f"- {item['promotion']}: {top.get('title','no candidate')} ({top.get('score','-')})")

if __name__ == "__main__":
    main()
