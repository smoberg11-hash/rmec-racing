"""Fetch an event's results from every link in its results_url cell (LiveLaps or MotoTally)."""

from __future__ import annotations

from . import livelaps, mototally


def describe(link: str) -> str:
    if mototally.is_index_link(link):
        series = mototally.INDEX_RE.search(link.strip()).group(1)
        return f"MotoTally {series} (race on the event date)"
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


def fetch_results(results_url, race_date=None) -> tuple[list[dict], list[tuple[str, int]]]:
    """All results for an event, plus (source label, count) per link for the log.
    A MotoTally series page (no race number) is resolved to the race on race_date."""
    results, counts = [], []
    for link in links(results_url):
        if mototally.is_index_link(link):
            if not race_date:
                raise ValueError(f"{link} is a series results page; the event needs a race date to pick the race.")
            link = mototally.resolve_index_link(link, race_date)
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
