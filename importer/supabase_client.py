"""A small Supabase (PostgREST) client using only the Python standard library."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request


class SupabaseError(RuntimeError):
    pass


class Supabase:
    def __init__(self, url: str, key: str):
        if not url or not key:
            raise SupabaseError("SUPABASE_URL and SUPABASE_SECRET_KEY must be set (see .env.example).")
        self.base = url.rstrip("/") + "/rest/v1/"
        self.key = key

    def _request(self, method, table, params=None, body=None, headers=None, retries=3):
        url = self.base + table
        if params:
            url += "?" + urllib.parse.urlencode(params, safe="(),.*:")
        h = {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        h.update(headers or {})
        data = json.dumps(body).encode("utf-8") if body is not None else None

        for attempt in range(retries):
            req = urllib.request.Request(url, data=data, method=method, headers=h)
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    raw = resp.read().decode("utf-8")
                    return json.loads(raw) if raw else None, resp.headers
            except urllib.error.HTTPError as e:
                detail = e.read().decode("utf-8", "replace")
                # Retry temporary failures (e.g. the Cloudflare 502 seen in n8n).
                if e.code >= 500 and attempt < retries - 1:
                    time.sleep(2 ** attempt * 2)
                    continue
                raise SupabaseError(f"{method} {table} failed ({e.code}): {detail}") from None
            except urllib.error.URLError as e:
                if attempt < retries - 1:
                    time.sleep(2 ** attempt * 2)
                    continue
                raise SupabaseError(f"{method} {table} failed: {e.reason}") from None

    def select(self, table, params=None, page_size=1000):
        """Read all matching rows, paging past Supabase's 1000-row limit."""
        rows, start = [], 0
        while True:
            batch, _ = self._request(
                "GET", table, params,
                headers={"Range-Unit": "items", "Range": f"{start}-{start + page_size - 1}"},
            )
            rows.extend(batch or [])
            if not batch or len(batch) < page_size:
                return rows
            start += page_size

    def upsert(self, table, rows, on_conflict, chunk=500):
        """Insert rows, updating existing ones that match `on_conflict`. Returns saved rows."""
        saved = []
        for i in range(0, len(rows), chunk):
            out, _ = self._request(
                "POST", table, {"on_conflict": on_conflict}, rows[i:i + chunk],
                headers={"Prefer": "resolution=merge-duplicates,return=representation"},
            )
            saved.extend(out or [])
        return saved

    def insert(self, table, rows, chunk=500):
        saved = []
        for i in range(0, len(rows), chunk):
            out, _ = self._request("POST", table, None, rows[i:i + chunk], headers={"Prefer": "return=representation"})
            saved.extend(out or [])
        return saved

    def delete(self, table, filters):
        out, _ = self._request("DELETE", table, filters, headers={"Prefer": "return=representation"})
        return out or []

    def update(self, table, filters, values):
        out, _ = self._request("PATCH", table, filters, values, headers={"Prefer": "return=representation"})
        return out or []
