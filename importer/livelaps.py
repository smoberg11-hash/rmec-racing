"""Fetch and parse race results from the LiveLaps JSON API."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request

PAGE_PREFIX = "https://www.livelaps.com/livelaps/scores/"
API_PREFIX = "https://www.livelaps.com/laravel/public/api/v1/livelaps/race/results/"


def api_url(results_url: str) -> str:
    """Turn a LiveLaps results page URL (or a bare race ID) into the JSON API URL."""
    url = str(results_url).strip().rstrip("/")
    if url.isdigit():
        return API_PREFIX + url
    if url.startswith(API_PREFIX):
        return url
    if url.startswith(PAGE_PREFIX):
        race_id = url[len(PAGE_PREFIX):].split("/")[0].split("?")[0]
        if race_id.isdigit():
            return API_PREFIX + race_id
    raise ValueError(f"Not a LiveLaps results URL: {results_url!r}")


def parse_payload(payload) -> tuple[list[dict], dict]:
    """Unwrap a LiveLaps API response into (results, page_info).

    Handles the shapes seen so far: a bare list, {"data": [...]}, the Laravel
    paginator {"data": [...], "has_more_pages": ...}, and n8n's habit of
    wrapping things in {"body": ...} or JSON strings.
    """
    obj = payload
    for _ in range(5):
        if isinstance(obj, str):
            obj = json.loads(obj)
            continue
        if isinstance(obj, dict) and "body" in obj and "data" not in obj:
            obj = obj["body"]
            continue
        break

    if isinstance(obj, list):
        return obj, {}

    if isinstance(obj, dict) and "data" in obj:
        data = obj["data"]
        if isinstance(data, str):
            data = json.loads(data)
        if isinstance(data, dict) and "data" in data:
            return parse_payload(data)
        if isinstance(data, list):
            page_info = {k: v for k, v in obj.items() if k != "data"}
            return data, page_info

    raise ValueError(f"Unexpected LiveLaps response shape: {type(obj).__name__}")


def _get_json(url: str, retries: int = 3):
    req = urllib.request.Request(
        url, headers={"Accept": "application/json", "User-Agent": "rmec-importer/1.0"}
    )
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError) as e:
            status = getattr(e, "code", None)
            if status is not None and status < 500 and status != 429:
                raise
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt * 2)


def fetch_results(results_url: str) -> list[dict]:
    """Download every result for a race, following pagination if there is any."""
    base = api_url(results_url)
    results: list[dict] = []
    page = 1
    while True:
        url = base if page == 1 else f"{base}?page={page}"
        rows, info = parse_payload(_get_json(url))
        results.extend(rows)
        if not info.get("has_more_pages"):
            break
        page += 1
        if page > 50:
            raise RuntimeError("LiveLaps pagination did not end after 50 pages")
    return results


def load_results_file(path: str) -> list[dict]:
    """Read results saved from the API (or from an n8n node output) on disk."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    start = min(i for i in (text.find("["), text.find("{")) if i >= 0)
    payload = json.loads(text[start:])
    # n8n node output: [{"json": {...}, "pairedItem": ...}]
    if isinstance(payload, list) and payload and isinstance(payload[0], dict) and "json" in payload[0]:
        payload = payload[0]["json"]
    rows, _ = parse_payload(payload)
    return rows
