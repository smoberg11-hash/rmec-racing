"""Fetch an event's results from every link in its results_url cell (LiveLaps or MotoTally)."""

from __future__ import annotations

from . import livelaps, mototally


def describe(link: str) -> str:
    if mototally.is_link(link):
        series, year, event = mototally.parse_link(link)
        return f"MotoTally {series} {year}/{event}"
    return f"LiveLaps race {livelaps.race_id(link)}"


def links(results_url) -> list[str]:
    found = livelaps.split_links(results_url)
    if not found:
        raise ValueError("Event has no results link.")
    labels = [describe(link) for link in found]  # also validates every link
    if len(labels) != len(set(labels)):
        raise ValueError(f"The same race is listed twice in results_url: {results_url!r}")
    return found


def fetch_results(results_url) -> tuple[list[dict], list[tuple[str, int]]]:
    """All results for an event, plus (source label, count) per link for the log."""
    results, counts = [], []
    for link in links(results_url):
        label = describe(link)
        if mototally.is_link(link):
            rows = mototally.fetch_results(link)
        else:
            rid = livelaps.race_id(link)
            rows = livelaps._fetch_one(rid)
            for r in rows:
                r["_livelaps_race"] = label
        results.extend(rows)
        counts.append((label, len(rows)))
    return results, counts
