#!/usr/bin/env python3
"""
YouTube Transcript Extractor for Course Materials App
Supports English (en) and Hindi (hi) transcripts
Uses Whisper AI for high-quality Hindi→English translation
"""

import sys
import json
import re
import os
import tempfile
from typing import Optional, Dict, Any

# Check for required packages
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    HAS_YT_TRANSCRIPT = True
except ImportError:
    HAS_YT_TRANSCRIPT = False

try:
    import whisper
    HAS_WHISPER = True
except ImportError:
    HAS_WHISPER = False

try:
    import yt_dlp
    HAS_YTDLP = True
except ImportError:
    HAS_YTDLP = False


def extract_video_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})',
        r'^([a-zA-Z0-9_-]{11})$'
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def format_timestamp(seconds: float) -> str:
    """Convert seconds to MM:SS or HH:MM:SS format."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def get_transcript_api(video_id: str, language: str = "auto") -> Dict[str, Any]:
    """Fetch transcript using youtube-transcript-api."""
    if not HAS_YT_TRANSCRIPT:
        return {"success": False, "error": "youtube-transcript-api not installed"}

    try:
        api = YouTubeTranscriptApi()

        if language == "auto":
            lang_list = ['en', 'hi']
        elif language == "en":
            lang_list = ['en']
        elif language == "hi":
            lang_list = ['hi']
        else:
            lang_list = [language]

        transcript_data = None
        used_language = None

        for lang in lang_list:
            try:
                transcript_data = api.fetch(video_id, languages=[lang])
                used_language = lang
                break
            except Exception:
                continue

        if transcript_data is None:
            try:
                transcript_data = api.fetch(video_id)
                used_language = 'auto-detected'
            except Exception as e:
                return {"success": False, "error": f"No transcript available: {str(e)}"}

        if not transcript_data:
            return {"success": False, "error": "No transcript available"}

        formatted_lines = []
        full_text_parts = []

        for entry in transcript_data:
            if hasattr(entry, 'text'):
                text = entry.text.strip()
                start = entry.start
                duration = getattr(entry, 'duration', 0)
            else:
                text = entry.get('text', '').strip()
                start = entry.get('start', 0)
                duration = entry.get('duration', 0)

            timestamp = format_timestamp(start)
            formatted_lines.append({
                "timestamp": timestamp,
                "start": start,
                "duration": duration,
                "text": text
            })
            full_text_parts.append(text)

        return {
            "success": True,
            "videoId": video_id,
            "language": used_language,
            "method": "youtube-api",
            "transcriptLines": formatted_lines,
            "fullText": " ".join(full_text_parts),
            "timestampedText": "\n".join([f"[{l['timestamp']}] {l['text']}" for l in formatted_lines]),
            "duration": formatted_lines[-1]['start'] if formatted_lines else 0,
            "lineCount": len(formatted_lines)
        }

    except Exception as e:
        return {"success": False, "error": f"API error: {str(e)}"}


def download_audio(video_id: str, output_dir: str) -> Optional[str]:
    """Download audio from YouTube video using yt-dlp."""
    if not HAS_YTDLP:
        return None

    output_path = os.path.join(output_dir, f"{video_id}.mp3")

    ydl_opts = {
        'format': 'bestaudio/best',
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '128',
        }],
        'outtmpl': os.path.join(output_dir, f"{video_id}.%(ext)s"),
        'quiet': True,
        'no_warnings': True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([f'https://www.youtube.com/watch?v={video_id}'])
        return output_path
    except Exception as e:
        print(f"Download error: {e}", file=sys.stderr)
        return None


def transcribe_with_whisper(audio_path: str, task: str = "translate", model_name: str = "base") -> Dict[str, Any]:
    """
    Transcribe audio using Whisper.
    task='translate' will translate any language to English.
    task='transcribe' will keep the original language.
    """
    if not HAS_WHISPER:
        return {"success": False, "error": "whisper not installed"}

    try:
        # Load model (base is good balance of speed/quality, use 'small' or 'medium' for better quality)
        model = whisper.load_model(model_name)

        # Transcribe/translate
        result = model.transcribe(
            audio_path,
            task=task,  # 'translate' converts to English, 'transcribe' keeps original
            verbose=False
        )

        segments = result.get('segments', [])
        formatted_lines = []
        full_text_parts = []

        for seg in segments:
            text = seg.get('text', '').strip()
            start = seg.get('start', 0)
            end = seg.get('end', 0)

            if text:
                timestamp = format_timestamp(start)
                formatted_lines.append({
                    "timestamp": timestamp,
                    "start": start,
                    "duration": end - start,
                    "text": text
                })
                full_text_parts.append(text)

        detected_lang = result.get('language', 'unknown')

        return {
            "success": True,
            "language": f"{detected_lang}→en" if task == 'translate' else detected_lang,
            "method": f"whisper-{model_name}",
            "transcriptLines": formatted_lines,
            "fullText": " ".join(full_text_parts),
            "timestampedText": "\n".join([f"[{l['timestamp']}] {l['text']}" for l in formatted_lines]),
            "duration": formatted_lines[-1]['start'] if formatted_lines else 0,
            "lineCount": len(formatted_lines)
        }

    except Exception as e:
        return {"success": False, "error": f"Whisper error: {str(e)}"}


def get_transcript_whisper(video_id: str, translate_to_english: bool = True, model: str = "base") -> Dict[str, Any]:
    """Get transcript using Whisper AI (downloads audio first)."""
    if not HAS_WHISPER or not HAS_YTDLP:
        missing = []
        if not HAS_WHISPER:
            missing.append("openai-whisper")
        if not HAS_YTDLP:
            missing.append("yt-dlp")
        return {
            "success": False,
            "error": f"Missing packages: {', '.join(missing)}. Run: pip install {' '.join(missing)}"
        }

    with tempfile.TemporaryDirectory() as temp_dir:
        # Download audio
        audio_path = download_audio(video_id, temp_dir)
        if not audio_path or not os.path.exists(audio_path):
            return {"success": False, "error": "Failed to download audio from YouTube"}

        # Transcribe with Whisper
        task = "translate" if translate_to_english else "transcribe"
        result = transcribe_with_whisper(audio_path, task=task, model_name=model)

        if result.get("success"):
            result["videoId"] = video_id

        return result


def get_transcript(video_id: str, language: str = "auto", use_whisper: bool = False, whisper_model: str = "base") -> Dict[str, Any]:
    """
    Main function to get transcript.

    Args:
        video_id: YouTube video ID
        language: 'en', 'hi', 'auto', or 'hi-whisper' (uses AI translation)
        use_whisper: Force use of Whisper AI
        whisper_model: Whisper model size ('tiny', 'base', 'small', 'medium', 'large')
    """

    # If requesting Hindi with Whisper translation
    if language == "hi-whisper" or (language == "hi" and use_whisper):
        result = get_transcript_whisper(video_id, translate_to_english=True, model=whisper_model)
        if result.get("success"):
            return result
        # Fall back to API if Whisper fails
        return get_transcript_api(video_id, "hi")

    # If explicitly requesting Whisper
    if use_whisper:
        translate = language != "en"  # Translate non-English to English
        return get_transcript_whisper(video_id, translate_to_english=translate, model=whisper_model)

    # Try API first
    result = get_transcript_api(video_id, language)

    # If API fails for Hindi, suggest using Whisper
    if not result.get("success") and language in ["hi", "auto"]:
        if HAS_WHISPER and HAS_YTDLP:
            result["suggestion"] = "Try 'hi-whisper' for AI-powered Hindi→English translation"

    return result


def main():
    """CLI entry point."""
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "Usage: python youtube_transcript.py <video_id> [language] [--whisper] [--model=base]"
        }))
        sys.exit(1)

    url_or_id = sys.argv[1]
    language = "auto"
    use_whisper = False
    whisper_model = "base"

    for arg in sys.argv[2:]:
        if arg == "--whisper":
            use_whisper = True
        elif arg.startswith("--model="):
            whisper_model = arg.split("=")[1]
        elif arg in ['en', 'hi', 'auto', 'hi-whisper']:
            language = arg

    video_id = extract_video_id(url_or_id)
    if not video_id:
        print(json.dumps({
            "success": False,
            "error": f"Could not extract video ID from: {url_or_id}"
        }))
        sys.exit(1)

    result = get_transcript(video_id, language, use_whisper, whisper_model)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
