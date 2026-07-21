#!/usr/bin/env python3
"""Download only Prism Stone images listed by the Pretty Rhythm Wiki.

The script uses MediaWiki's API, not browser automation or AI vision.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


API = "https://puritirizumu.fandom.com/api.php"
USER_AGENT = "PrismStonePersonalArchiver/1.0 (personal offline archive; polite API client)"
STONE_TYPES = {
    "star": "Star_Navi",
    "lovely": "Lovely_Navi",
    "pop": "Pop_Navi",
    "feminine": "Feminine_Navi",
    "ethnic": "Ethnic_Navi",
    "cool": "Cool_Navi",
    "sexy": "Sexy_Navi",
    "surprise": "Surprise_Navi",
}
INVALID_FILENAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def api_get(params: dict[str, str], retries: int = 4) -> dict:
    params = {"format": "json", "formatversion": "2", "maxlag": "5", **params}
    url = API + "?" + urlencode(params)
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(req, timeout=45) as response:
                return json.load(response)
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            if attempt == retries - 1:
                raise RuntimeError(f"API request failed: {exc}") from exc
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def chunks(items: list[str], size: int = 50):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def page_wikitext(title: str) -> str:
    data = api_get({
        "action": "query",
        "prop": "revisions",
        "rvprop": "content",
        "rvslots": "main",
        "titles": title,
    })
    page = data["query"]["pages"][0]
    if page.get("missing"):
        return ""
    return page["revisions"][0]["slots"]["main"]["content"]


def pages_wikitext(titles: list[str]) -> dict[str, str]:
    found: dict[str, str] = {}
    for batch in chunks(titles):
        data = api_get({
            "action": "query",
            "prop": "revisions",
            "rvprop": "content",
            "rvslots": "main",
            "redirects": "1",
            "titles": "|".join(batch),
        })
        for page in data.get("query", {}).get("pages", []):
            revisions = page.get("revisions") or []
            if revisions:
                found[page["title"]] = revisions[0]["slots"]["main"]["content"]
        time.sleep(0.15)
    return found


def type_pages(stone_type: str) -> list[str]:
    template = STONE_TYPES[stone_type]
    text = page_wikitext(f"Template:{template}")
    links = re.findall(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]", text)
    excluded = {stone_type.casefold(), f"template:{template}".casefold()}
    result: list[str] = []
    seen: set[str] = set()
    for raw in links:
        title = html.unescape(raw).strip().replace("_", " ")
        folded = title.casefold()
        if ":" in title or folded in excluded or folded in seen:
            continue
        seen.add(folded)
        result.append(title)
    return result


def clean_markup(value: str) -> str:
    value = re.sub(r"<br\s*/?>", "\n", value, flags=re.I)
    value = re.sub(r"<!--.*?-->", "", value, flags=re.S)
    value = re.sub(r"\[\[(?:[^\]|]+\|)?([^\]]+)\]\]", r"\1", value)
    value = re.sub(r"\{\{.*?\}\}", "", value, flags=re.S)
    value = re.sub(r"<[^>]+>", "", value)
    return html.unescape(value).strip()


def parse_codes(text: str) -> list[str]:
    match = re.search(r"^\s*\|\s*code\s*=\s*(.*?)(?=^\s*\|\s*\w+\s*=|^\s*}})", text, re.I | re.M | re.S)
    if not match:
        return []
    lines = clean_markup(match.group(1)).splitlines()
    codes: list[str] = []
    for line in lines:
        line = re.sub(r"\s*\([^)]*\)\s*$", "", line).strip()
        # Printed codes can contain kana designators (P-シ04★, P-ウ★,
        # P-ぷ 01★) and a heart suffix.  The old ASCII-only expression
        # silently discarded those segments and shifted every later image on
        # the same page onto the wrong code.
        code_match = re.match(
            r"([A-Za-z0-9]+(?:[-/][A-Za-z0-9ぁ-んァ-ヶ一-龯]+)*(?:\s+\d+)?[★♥]?)",
            line,
        )
        if code_match:
            codes.append(code_match.group(1))
    return codes


def parse_file_name(line: str) -> str | None:
    line = line.strip().lstrip("*").strip()
    if not line or line.startswith(("<!--", "{{", "|")):
        return None
    line = re.sub(r"^File:", "", line, flags=re.I)
    name = line.split("|", 1)[0].strip()
    return name if re.search(r"\.(?:png|jpe?g|webp|gif)$", name, re.I) else None


def parse_prism_images(text: str) -> tuple[str | None, list[str], list[str]]:
    codes = parse_codes(text)
    info_match = re.search(r"^\s*\|\s*image\s*=\s*\[\[\s*File:([^\]|]+)", text, re.I | re.M)
    info_image = info_match.group(1).strip() if info_match else None

    gallery_files: list[str] = []
    section = re.search(
        r"^===+\s*Prism Stones?\s*===+\s*(.*?)(?=^===+|^==[^=]|\Z)",
        text,
        re.I | re.M | re.S,
    )
    if section:
        for gallery in re.findall(r"<gallery[^>]*>(.*?)</gallery>", section.group(1), re.I | re.S):
            for line in gallery.splitlines():
                name = parse_file_name(line)
                if name:
                    gallery_files.append(name)

    ordered: list[str] = []
    for name in ([info_image] if info_image else []) + gallery_files:
        if name and name.casefold() not in {x.casefold() for x in ordered}:
            ordered.append(name)
    return info_image, ordered, codes


def image_urls(file_names: list[str]) -> dict[str, str]:
    urls: dict[str, str] = {}
    titles = ["File:" + name for name in file_names]
    for batch in chunks(titles):
        data = api_get({
            "action": "query",
            "prop": "imageinfo",
            "iiprop": "url",
            "titles": "|".join(batch),
        })
        for page in data.get("query", {}).get("pages", []):
            info = page.get("imageinfo") or []
            if info:
                urls[page["title"].removeprefix("File:")] = info[0]["url"]
        time.sleep(0.15)
    return urls


def safe_name(value: str) -> str:
    # Windows forbids a literal slash in a filename.  Preserve its visual
    # meaning with the full-width slash instead of truncating the code.
    value = value.replace("/", "／")
    value = INVALID_FILENAME.sub("_", value).strip().rstrip(".")
    return re.sub(r"\s+", " ", value) or "unnamed"


def code_for_image(file_name: str, info_image: str | None, codes: list[str], index: int) -> str:
    stem = Path(file_name).stem
    if info_image and file_name.casefold() == info_image.casefold() and codes:
        return codes[0]
    # Prism Stone gallery filenames are normally the exact printed code.  Keeping
    # the complete stem also preserves suffixes such as A★ and M001★.
    if " " not in stem and re.search(r"\d", stem) and re.search(r"[-★]", stem):
        return stem
    if index < len(codes):
        return codes[index]
    return stem


def download(url: str, target: Path, retries: int = 4) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".part")
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": USER_AGENT})
            with urlopen(req, timeout=90) as response, partial.open("wb") as out:
                while block := response.read(1024 * 256):
                    out.write(block)
            partial.replace(target)
            return
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            partial.unlink(missing_ok=True)
            if attempt == retries - 1:
                raise RuntimeError(str(exc)) from exc
            time.sleep(2 ** attempt)


def main() -> int:
    # Some Windows terminals use GBK and cannot print characters such as ♪ or ☆.
    # Escaping only the console representation keeps filenames and CSV data intact.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="backslashreplace")

    parser = argparse.ArgumentParser(description="Download Pretty Rhythm Prism Stone images only")
    parser.add_argument("--output", default="Prism Stones", help="output directory")
    parser.add_argument("--types", nargs="+", choices=sorted(STONE_TYPES), default=list(STONE_TYPES))
    parser.add_argument("--limit", type=int, default=0, help="limit clothing pages per type (for testing)")
    parser.add_argument("--dry-run", action="store_true", help="build the list without downloading images")
    args = parser.parse_args()

    output = Path(args.output).resolve()
    records: list[dict[str, str]] = []
    missing_pages: list[str] = []

    for stone_type in args.types:
        titles = type_pages(stone_type)
        if args.limit:
            titles = titles[: args.limit]
        print(f"[{stone_type}] {len(titles)} clothing pages", flush=True)
        texts = pages_wikitext(titles)
        for title in titles:
            text = texts.get(title)
            if text is None:
                # Redirect normalization can change the returned title; fall back to one query.
                text = page_wikitext(title)
            if not text:
                missing_pages.append(title)
                continue
            info_image, files, codes = parse_prism_images(text)
            for index, file_name in enumerate(files):
                records.append({
                    "type": stone_type,
                    "clothing": title,
                    "code": code_for_image(file_name, info_image, codes, index),
                    "wiki_file": file_name,
                    "url": "",
                    "saved_as": "",
                    "status": "planned",
                })

    files = list(dict.fromkeys(row["wiki_file"] for row in records))
    urls = image_urls(files)
    used_targets: set[str] = set()

    for row in records:
        file_name = row["wiki_file"]
        url = urls.get(file_name, "")
        row["url"] = url
        extension = Path(urlparse(url).path).suffix or Path(file_name).suffix or ".png"
        base = safe_name(f'{row["code"]} - {row["clothing"]}')
        target = output / row["type"] / f"{base}{extension.lower()}"
        counter = 2
        while str(target).casefold() in used_targets:
            target = output / row["type"] / f"{base} ({counter}){extension.lower()}"
            counter += 1
        used_targets.add(str(target).casefold())
        row["saved_as"] = str(target)

        if not url:
            row["status"] = "missing image URL"
        elif args.dry_run:
            row["status"] = "dry run"
        elif target.exists() and target.stat().st_size > 0:
            row["status"] = "already exists"
        else:
            # A previous run may already have moved this image into a season
            # subfolder.  Find it by its unique generated basename so rerunning
            # the downloader does not fetch another copy.
            organized = next(
                (p for p in (output / row["type"]).glob(f"*/{target.name}") if p.is_file()),
                None,
            )
            if organized and organized.stat().st_size > 0:
                row["saved_as"] = str(organized)
                row["status"] = "already organized"
                print(f'{row["status"]:>16}  {row["code"]} - {row["clothing"]}', flush=True)
                continue
            try:
                download(url, target)
                row["status"] = "downloaded"
                time.sleep(0.12)
            except RuntimeError as exc:
                row["status"] = f"error: {exc}"
        print(f'{row["status"]:>16}  {row["code"]} - {row["clothing"]}', flush=True)

    output.mkdir(parents=True, exist_ok=True)
    manifest = output / "manifest.csv"
    with manifest.open("w", newline="", encoding="utf-8-sig") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(records[0]) if records else ["type", "clothing", "code", "wiki_file", "url", "saved_as", "status"])
        writer.writeheader()
        writer.writerows(records)

    print(f"\nDone: {len(records)} images; manifest: {manifest}")
    if missing_pages:
        print(f"Pages not found: {len(missing_pages)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
