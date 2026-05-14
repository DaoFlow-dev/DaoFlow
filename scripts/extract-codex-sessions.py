#!/usr/bin/env python3
"""
Extract conversation histories from OpenAI Codex CLI sessions (~/.codex/sessions).

Filters sessions by working directory and renders human-readable transcripts.

Usage:
    # List all sessions for this project
    python3 scripts/extract-codex-sessions.py --list

    # Extract a specific session by index (from --list)
    python3 scripts/extract-codex-sessions.py --session 5

    # Extract the latest N sessions
    python3 scripts/extract-codex-sessions.py --latest 3

    # Extract all sessions to a directory
    python3 scripts/extract-codex-sessions.py --all --outdir .codex-transcripts

    # Search sessions for a keyword
    python3 scripts/extract-codex-sessions.py --search "backup"

    # Filter by date range
    python3 scripts/extract-codex-sessions.py --after 2026-05-01 --before 2026-05-08 --list

    # Custom project path
    python3 scripts/extract-codex-sessions.py --cwd /some/other/project --list

    # Include tool calls in output
    python3 scripts/extract-codex-sessions.py --latest 1 --tools

    # Summary mode (just user prompts and assistant responses, no tool details)
    python3 scripts/extract-codex-sessions.py --latest 1 --summary
"""

import argparse
import json
import os
import sys
import textwrap
from datetime import datetime
from pathlib import Path


SESSIONS_DIR = Path.home() / ".codex" / "sessions"
DEFAULT_CWD = "/Volumes/QuickMac/DaoFlow"


def find_sessions(cwd: str, after: str | None = None, before: str | None = None) -> list[dict]:
    """Find all session files matching the given cwd, sorted by timestamp."""
    sessions = []
    for jsonl_path in SESSIONS_DIR.rglob("*.jsonl"):
        try:
            with open(jsonl_path) as f:
                first_line = f.readline().strip()
                if not first_line:
                    continue
                meta = json.loads(first_line)
                if meta.get("type") != "session_meta":
                    continue
                payload = meta.get("payload", {})
                session_cwd = payload.get("cwd", "")
                if session_cwd != cwd:
                    continue
                ts = payload.get("timestamp", "")
                if after and ts < after:
                    continue
                if before and ts > before:
                    continue
                line_count = sum(1 for _ in open(jsonl_path))
                sessions.append({
                    "path": str(jsonl_path),
                    "timestamp": ts,
                    "id": payload.get("id", ""),
                    "model": "",
                    "cli_version": payload.get("cli_version", ""),
                    "lines": line_count,
                    "size": jsonl_path.stat().st_size,
                })
        except (json.JSONDecodeError, OSError):
            continue
    sessions.sort(key=lambda s: s["timestamp"])
    for i, s in enumerate(sessions):
        s["index"] = i
    return sessions


def parse_session(path: str) -> dict:
    """Parse a session JSONL file into structured data."""
    records = []
    meta = None
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = json.loads(line)
                if record.get("type") == "session_meta":
                    meta = record.get("payload", {})
                records.append(record)
            except json.JSONDecodeError:
                continue
    return {"meta": meta, "records": records}


def extract_text_content(content) -> str:
    """Extract text from various content formats."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                if item.get("type") == "output_text":
                    parts.append(item.get("text", ""))
                elif item.get("type") == "input_text":
                    parts.append(item.get("text", ""))
                elif item.get("type") == "text":
                    parts.append(item.get("text", ""))
            elif isinstance(item, str):
                parts.append(item)
        return "\n".join(parts)
    return ""


def render_transcript(session_data: dict, include_tools: bool = False, summary: bool = False) -> str:
    """Render a session into a human-readable transcript."""
    meta = session_data["meta"] or {}
    records = session_data["records"]

    lines = []
    lines.append(f"{'=' * 80}")
    lines.append(f"Session: {meta.get('id', 'unknown')}")
    lines.append(f"Date:    {meta.get('timestamp', 'unknown')}")
    lines.append(f"CWD:     {meta.get('cwd', 'unknown')}")
    lines.append(f"CLI:     {meta.get('cli_version', 'unknown')}")
    git = meta.get("git", {})
    if git:
        lines.append(f"Branch:  {git.get('branch', 'unknown')}")
    lines.append(f"{'=' * 80}")
    lines.append("")

    pending_calls = {}  # call_id -> function name

    for record in records:
        rtype = record.get("type", "")
        payload = record.get("payload", {})
        ts = record.get("timestamp", "")

        if rtype == "event_msg":
            msg = payload.get("message", "")
            if isinstance(msg, str) and msg.strip():
                # User messages from event_msg
                if payload.get("type") == "user_message":
                    lines.append(f"┌─ USER [{ts[:19]}]")
                    for mline in msg.strip().split("\n"):
                        lines.append(f"│ {mline}")
                    lines.append(f"└─")
                    lines.append("")

        elif rtype == "response_item":
            item_type = payload.get("type", "")

            if item_type == "message":
                role = payload.get("role", "")
                content = extract_text_content(payload.get("content", ""))
                if content.strip():
                    if role == "assistant":
                        lines.append(f"┌─ ASSISTANT [{ts[:19]}]")
                        for mline in content.strip().split("\n"):
                            lines.append(f"│ {mline}")
                        lines.append(f"└─")
                        lines.append("")

            elif item_type == "function_call" and include_tools and not summary:
                name = payload.get("name", "unknown")
                call_id = payload.get("call_id", "")
                args = payload.get("arguments", "")
                pending_calls[call_id] = name
                try:
                    args_parsed = json.loads(args) if isinstance(args, str) else args
                    if isinstance(args_parsed, dict):
                        # Show command for shell calls, path for file reads
                        detail = ""
                        if "command" in args_parsed:
                            cmd = args_parsed["command"]
                            detail = f" $ {cmd[:200]}"
                        elif "file_path" in args_parsed:
                            detail = f" {args_parsed['file_path']}"
                        elif "path" in args_parsed:
                            detail = f" {args_parsed['path']}"
                        lines.append(f"  ⚙ {name}{detail}")
                    else:
                        lines.append(f"  ⚙ {name}")
                except (json.JSONDecodeError, TypeError):
                    lines.append(f"  ⚙ {name}")

            elif item_type == "function_call_output" and include_tools and not summary:
                call_id = payload.get("call_id", "")
                output = payload.get("output", "")
                fn_name = pending_calls.pop(call_id, "?")
                if isinstance(output, str) and len(output) > 300:
                    output = output[:300] + "..."
                lines.append(f"  ← {fn_name}: {output[:200]}")
                lines.append("")

            elif item_type == "reasoning" and not summary:
                summaries = payload.get("summary", [])
                if summaries and include_tools:
                    for s in summaries[:3]:
                        text = s.get("text", "") if isinstance(s, dict) else str(s)
                        if text:
                            lines.append(f"  💭 {text[:200]}")
                    lines.append("")

        elif rtype == "compacted":
            if not summary:
                lines.append(f"  [--- context compacted ---]")
                lines.append("")

    return "\n".join(lines)


def search_sessions(sessions: list[dict], keyword: str) -> list[dict]:
    """Search session files for a keyword in user messages and assistant responses."""
    matches = []
    keyword_lower = keyword.lower()
    for session in sessions:
        path = session["path"]
        found_lines = []
        try:
            with open(path) as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    record = json.loads(line)
                    rtype = record.get("type", "")
                    payload = record.get("payload", {})

                    text = ""
                    if rtype == "event_msg":
                        text = payload.get("message", "")
                    elif rtype == "response_item" and payload.get("type") == "message":
                        text = extract_text_content(payload.get("content", ""))

                    if isinstance(text, str) and keyword_lower in text.lower():
                        snippet = text.strip()[:150].replace("\n", " ")
                        found_lines.append(snippet)
        except (json.JSONDecodeError, OSError):
            continue

        if found_lines:
            session_copy = dict(session)
            session_copy["matches"] = found_lines
            matches.append(session_copy)
    return matches


def format_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes}B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f}KB"
    else:
        return f"{size_bytes / (1024 * 1024):.1f}MB"


def main():
    parser = argparse.ArgumentParser(
        description="Extract Codex CLI conversation histories",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--cwd", default=DEFAULT_CWD, help=f"Project directory to filter by (default: {DEFAULT_CWD})")
    parser.add_argument("--list", action="store_true", help="List all matching sessions")
    parser.add_argument("--session", type=int, help="Extract session by index (from --list)")
    parser.add_argument("--latest", type=int, help="Extract the latest N sessions")
    parser.add_argument("--all", action="store_true", help="Extract all sessions")
    parser.add_argument("--search", type=str, help="Search sessions for a keyword")
    parser.add_argument("--after", type=str, help="Only sessions after this date (YYYY-MM-DD)")
    parser.add_argument("--before", type=str, help="Only sessions before this date (YYYY-MM-DD)")
    parser.add_argument("--outdir", type=str, help="Write transcripts to this directory instead of stdout")
    parser.add_argument("--tools", action="store_true", help="Include tool calls in output")
    parser.add_argument("--summary", action="store_true", help="Summary mode: only user prompts and assistant text")
    parser.add_argument("--json", action="store_true", dest="json_output", help="Output as JSON instead of text")
    args = parser.parse_args()

    if not SESSIONS_DIR.exists():
        print(f"Sessions directory not found: {SESSIONS_DIR}", file=sys.stderr)
        sys.exit(1)

    sessions = find_sessions(args.cwd, after=args.after, before=args.before)

    if not sessions:
        print("No sessions found.", file=sys.stderr)
        sys.exit(0)

    if args.search:
        matches = search_sessions(sessions, args.search)
        if not matches:
            print(f"No sessions contain '{args.search}'.", file=sys.stderr)
            sys.exit(0)
        print(f"Found {len(matches)} session(s) matching '{args.search}':\n")
        for s in matches:
            ts = s["timestamp"][:19].replace("T", " ")
            print(f"  [{s['index']:3d}] {ts}  {format_size(s['size']):>8s}  {len(s['matches'])} match(es)")
            for m in s["matches"][:3]:
                print(f"        → {m}")
            if len(s["matches"]) > 3:
                print(f"        ... and {len(s['matches']) - 3} more")
            print()
        return

    if args.list:
        print(f"Found {len(sessions)} session(s) for {args.cwd}:\n")
        for s in sessions:
            ts = s["timestamp"][:19].replace("T", " ")
            print(f"  [{s['index']:3d}] {ts}  {s['lines']:5d}L  {format_size(s['size']):>8s}  {s['cli_version']}")
        print(f"\nUse --session N to extract a session, --latest N for recent ones.")
        return

    # Determine which sessions to extract
    to_extract = []
    if args.session is not None:
        matching = [s for s in sessions if s["index"] == args.session]
        if not matching:
            print(f"Session index {args.session} not found. Use --list to see available sessions.", file=sys.stderr)
            sys.exit(1)
        to_extract = matching
    elif args.latest:
        to_extract = sessions[-args.latest:]
    elif args.all:
        to_extract = sessions
    else:
        parser.print_help()
        sys.exit(0)

    # Extract and output
    for session_info in to_extract:
        session_data = parse_session(session_info["path"])

        if args.json_output:
            # Structured JSON output
            result = {
                "meta": session_data["meta"],
                "turns": [],
            }
            for record in session_data["records"]:
                rtype = record.get("type", "")
                payload = record.get("payload", {})
                if rtype == "event_msg" and payload.get("message"):
                    result["turns"].append({
                        "role": "user",
                        "text": payload["message"],
                        "timestamp": record.get("timestamp", ""),
                    })
                elif rtype == "response_item" and payload.get("type") == "message" and payload.get("role") == "assistant":
                    text = extract_text_content(payload.get("content", ""))
                    if text.strip():
                        result["turns"].append({
                            "role": "assistant",
                            "text": text,
                            "timestamp": record.get("timestamp", ""),
                        })
                elif rtype == "response_item" and payload.get("type") == "function_call" and args.tools:
                    result["turns"].append({
                        "role": "tool_call",
                        "name": payload.get("name", ""),
                        "arguments": payload.get("arguments", ""),
                        "timestamp": record.get("timestamp", ""),
                    })
            output = json.dumps(result, indent=2)
        else:
            output = render_transcript(session_data, include_tools=args.tools, summary=args.summary)

        if args.outdir:
            outdir = Path(args.outdir)
            outdir.mkdir(parents=True, exist_ok=True)
            ts = session_info["timestamp"][:10]
            sid = session_info["id"][:8]
            ext = "json" if args.json_output else "txt"
            outpath = outdir / f"session-{ts}-{sid}.{ext}"
            with open(outpath, "w") as f:
                f.write(output)
            print(f"  Wrote {outpath}")
        else:
            print(output)
            print()


if __name__ == "__main__":
    main()
