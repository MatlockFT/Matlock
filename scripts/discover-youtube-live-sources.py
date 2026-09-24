#!/usr/bin/env python3
import json
import os
import re
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
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
        found, error = search_channels(query)
        ranked = []
        for candidate in found:
            candidate["score"] = score_candidate(
                entry.get("promotion") or "",
                candidate.get("title") or "",
                candidate.get("description") or "",
            )
            ranked.append(candidate)
        ranked.sort(key=lambda x:(-x["score"], x["title"]))

        output["results"].append({
            "id":entry.get("id"),
            "promotion":entry.get("promotion"),
            "event":entry.get("event"),
            "query":query,
            "error":error or None,
            "candidates":ranked,
        })

    OUT_PATH.write_text(json.dumps(output, indent=2, ensure_ascii=False)+"\n", encoding="utf-8")
    print(f"Searched {len(research)} unresolved promotions.")
    for item in output["results"]:
        top = (item["candidates"] or [{}])[0]
        print(f"- {item['promotion']}: {top.get('title','no candidate')} ({top.get('score','-')})")

if __name__ == "__main__":
    main()
