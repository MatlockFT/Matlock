#!/usr/bin/env python3
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from faster_whisper import WhisperModel


def vtt_time(seconds):
    total_ms = max(0, int(round(float(seconds or 0) * 1000)))
    hours, remainder = divmod(total_ms, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def clean_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def wrap_caption(text, width=42):
    clean = clean_text(text)
    words = clean.split()
    if not words or len(clean) <= width:
        return clean

    best = None
    for index in range(1, len(words)):
        left = " ".join(words[:index])
        right = " ".join(words[index:])
        overflow = max(0, len(left) - width) + max(0, len(right) - width)
        score = overflow * 100 + abs(len(left) - len(right))
        if best is None or score < best[0]:
            best = (score, left, right)

    return best[1] + "\n" + best[2] if best else clean


def segment_cues(segment):
    words = [word for word in (segment.words or []) if clean_text(word.word)]
    if not words:
        text = clean_text(segment.text)
        return [(segment.start, segment.end, text)] if text else []

    cues = []
    bucket = []
    start = None
    for word in words:
        if start is None:
            start = float(word.start if word.start is not None else segment.start)
        bucket.append(word)
        end = float(word.end if word.end is not None else segment.end)
        text = clean_text("".join(part.word for part in bucket))
        duration = end - start
        if len(bucket) >= 10 or len(text) >= 72 or duration >= 4.6:
            cues.append((start, end, text))
            bucket = []
            start = None

    if bucket:
        cue_start = float(bucket[0].start if bucket[0].start is not None else segment.start)
        cue_end = float(bucket[-1].end if bucket[-1].end is not None else segment.end)
        cues.append((cue_start, cue_end, clean_text("".join(part.word for part in bucket))))
    return cues


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-vtt", required=True)
    parser.add_argument("--output-json", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--caption-url", required=True)
    parser.add_argument("--model", default="small")
    parser.add_argument("--prompt", default="")
    args = parser.parse_args()

    model = WhisperModel(args.model, device="cpu", compute_type="int8")
    segments, info = model.transcribe(
        args.input,
        beam_size=5,
        vad_filter=True,
        word_timestamps=True,
        condition_on_previous_text=True,
        temperature=0,
        initial_prompt=clean_text(args.prompt) or None,
    )

    cues = []
    for segment in segments:
        cues.extend(segment_cues(segment))

    vtt_path = Path(args.output_vtt)
    json_path = Path(args.output_json)
    vtt_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.parent.mkdir(parents=True, exist_ok=True)

    lines = ["WEBVTT", ""]
    for index, (start, end, text) in enumerate(cues, 1):
        if not text:
            continue
        lines.extend([
            str(index),
            f"{vtt_time(start)} --> {vtt_time(max(end, start + 0.25))}",
            wrap_caption(text),
            "",
        ])
    vtt_path.write_text("\n".join(lines), encoding="utf-8")

    status = {
        "version": 1,
        "key": args.key,
        "state": "ready",
        "sourceUrl": args.source_url,
        "captionUrl": args.caption_url,
        "model": args.model,
        "prompt": clean_text(args.prompt),
        "language": getattr(info, "language", "") or "",
        "languageProbability": round(float(getattr(info, "language_probability", 0) or 0), 4),
        "duration": round(float(getattr(info, "duration", 0) or 0), 3),
        "cueCount": len(cues),
        "completedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    json_path.write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
