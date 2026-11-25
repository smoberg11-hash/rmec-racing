"""Read race results from MotoTally (moto-tally.com), e.g. the CORCS series.

A race link looks like
    https://www.moto-tally.com/CORCS/Results.aspx/2026/3
(series CORCS, season 2026, race #3 on the series' results page). Each class has
a "Summary" page at .../2026/3/<class code>/S listing every rider's overall place
(within their overall group, e.g. "Overall A/B"), class place, name, brand and
laps/time, plus DNF rows.

Results are returned in the same shape as LiveLaps results so the rest of the
importer works unchanged. MotoTally has no rider ids, so riders are matched by
name (see pipeline.rider_key).
"""

from __future__ import annotations

import html as html_lib
import os
import re
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser

# Series can be one or more path parts: /CORCS/Results.aspx/2026/3 or /IERA/HS/Results.aspx/2026/1
LINK_RE = re.compile(r"moto-tally\.com/((?:[^/?#]+/)*?[^/?#]+)/Results\.aspx/(\d{4})/(\d+)", re.I)
STATUS_WORDS = {"DNF", "DNS", "DQ", "DSQ", "DISQ"}


def is_link(link: str) -> bool:
    return bool(LINK_RE.search(str(link or "")))


def parse_link(link: str) -> tuple[str, str, str]:
    m = LINK_RE.search(str(link or ""))
    if not m:
        raise ValueError(
            f"Not a MotoTally race link: {link!r}. Use e.g. https://www.moto-tally.com/CORCS/Results.aspx/2026/3")
    return m.group(1), m.group(2), m.group(3)


class _PageParser(HTMLParser):
    """Collects the class <select> options, the page title, and every table's rows."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.options: list[tuple[str, str]] = []
        self.tables: list[list[list[tuple[str, str]]]] = []
        self.title = ""
        self._in_select = self._in_option = self._in_title = False
        self._opt_value = ""
        self._opt_text: list[str] = []
        self._stack: list[dict] = []   # open tables: {"rows": [...], "row": [...]|None, "cell": [...]|None, "tag": str}


    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "select" and a.get("name", "").endswith("ddlSelectClass"):
            self._in_select = True
        elif tag == "option" and self._in_select:
            self._in_option, self._opt_value, self._opt_text = True, a.get("value", ""), []
        elif tag == "title":
            self._in_title = True
        elif tag == "table":
            rows: list = []
            self.tables.append(rows)
            self._stack.append({"rows": rows, "row": None, "cell": None, "tag": ""})
        elif tag == "tr" and self._stack:
            self._stack[-1]["row"] = []
        elif tag in ("td", "th") and self._stack and self._stack[-1]["row"] is not None:
            self._stack[-1]["cell"], self._stack[-1]["tag"], self._stack[-1]["rid"] = [], tag, None
        elif tag == "a" and self._stack and self._stack[-1]["cell"] is not None:
            m = re.search(r"getRiderDetail\((\d+)\)", a.get("href") or "")
            if m:
                self._stack[-1]["rid"] = m.group(1)
        elif tag == "br" and self._stack and self._stack[-1]["cell"] is not None:
            self._stack[-1]["cell"].append(" ")

    def handle_endtag(self, tag):
        if tag == "select":
            self._in_select = False
        elif tag == "option" and self._in_option:
            self.options.append((self._opt_value, " ".join("".join(self._opt_text).split())))
            self._in_option = False
        elif tag == "title":
            self._in_title = False
        elif tag == "table" and self._stack:
            self._stack.pop()
        elif tag in ("td", "th") and self._stack and self._stack[-1]["cell"] is not None:
            top = self._stack[-1]
            if top["row"] is not None:
                top["row"].append((top["tag"], " ".join("".join(top["cell"]).replace("\xa0", " ").split()), top.get("rid")))
            top["cell"] = None
        elif tag == "tr" and self._stack and self._stack[-1]["row"] is not None:
            top = self._stack[-1]
            top["rows"].append(top["row"])
            top["row"] = None

    def handle_data(self, data):
        if self._in_option:
            self._opt_text.append(data)
        if self._in_title:
            self.title += data
        if self._stack and self._stack[-1]["cell"] is not None:
            self._stack[-1]["cell"].append(data)


def repair_html(text: str) -> str:
    """MotoTally writes the brand cell as `<span ...>KAW</span</td>` (missing '>').
    Browsers recover; Python's parser doesn't, so close any such end tag."""
    return re.sub(r"</([a-zA-Z][a-zA-Z0-9]*)<", r"</\1><", text)


def parse_page(text: str) -> _PageParser:
    p = _PageParser()
    p.feed(repair_html(text))
    return p


def class_options(page: _PageParser) -> list[tuple[str, str]]:
    """(code, name) for each class on the race (skips the 'Overall …' group views)."""
    return [(code, name) for code, name in page.options if code.upper().startswith("C")]


def clean_name(name: str) -> str:
    """'Jackson Watson ***' -> 'Jackson Watson' (MotoTally marks some riders with stars)."""
    return " ".join(re.sub(r"\*+", " ", name or "").split())


def _int(v):
    v = (v or "").strip()
    return int(v) if v.isdigit() else None


def parse_class_page(text: str, class_name: str, *, source: str, key_prefix: str) -> list[dict]:
    """Turn one class Summary page into LiveLaps-shaped result dicts."""
    page = parse_page(text)
    table = None
    for t in reversed(page.tables):
        if any(any(c[1] == "Rider Name" for c in row) for row in t):
            table = t
            break
    if table is None:
        return []

    header = next(row for row in table if any(c[1] == "Rider Name" for c in row))
    group_label = header[0][1] if header else ""
    if group_label.lower().startswith("oaplace"):
        # Plain layout: OAPlace13 | OASPlace13 | OAPoints13 | CPlace | CSPlace | CPoints | Rider Name | ...
        # (an overall group with no display name; "13" is MotoTally's group number)
        # "OAPlace1" is the overall group with code O1 in the class menu, e.g. "Overall A/B".
        number = re.sub(r"\D", "", group_label)
        group = dict(page.options).get(f"O{number}") or f"Overall group {number or '?'}"
        names = [c[1] for c in header[6:]]
    else:
        # Grouped layout: "Overall A/B Results" | "<class> Results" | Rider Name | ...
        group = re.sub(r"\s*Results$", "", group_label).strip() if group_label.lower().startswith("overall") else None
        names = [c[1] for c in header[2:]]

    results = []
    for row in table:
        if any(c[0] != "td" for c in row) or len(row) != 6 + len(names):
            continue
        cells = [c[1] for c in row]
        rider_mt_id = next((c[2] for c in row if c[2]), None)
        extra = dict(zip(names, cells[6:]))
        full = clean_name(extra.get("Rider Name", ""))
        if not full:
            continue
        overall_cell, class_cell = cells[0].upper(), cells[3].upper()
        class_place = _int(class_cell)
        standing = "Scored" if class_place else (class_cell if class_cell in STATUS_WORDS else (class_cell or "Unknown"))
        first, _, last = full.partition(" ")
        laps = _int(extra.get("Laps"))
        number = extra.get("Rider#") or None
        results.append({
            "id": None,
            # MotoTally's own rider id when the name links to one; otherwise the name.
            "source_key": f"{key_prefix}/" + (f"r{rider_mt_id}" if rider_mt_id else
                                               re.sub(r'[^a-z0-9]+', '-', full.lower()).strip('-')),
            "mototally_rider_id": rider_mt_id,
            "userId": None,
            "firstName": first,
            "lastName": last,
            "fullName": full,
            "displayedNumber": number,
            "brand": extra.get("Brand") or None,
            "className": class_name,
            "classPosition": class_place,
            "overallPosition": None,
            "groupPosition": _int(overall_cell),
            "classGroup": group,
            "standing": standing,
            "isDisqualified": class_cell in ("DQ", "DSQ", "DISQ"),
            # Hare scrambles report laps; enduros don't, so a placed rider counts as "scored".
            "sectionsCompleted": laps if laps is not None else (1 if class_place else 0),
            "totalCumulatedTime": extra.get("Total Time") or None,
            "averageTime": None,
            "bestTime": None,
            "_livelaps_race": source,
        })
    return results


def _get(url: str, retries: int = 3) -> str:
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
                      "(KHTML, like Gecko) Version/17.0 Safari/605.1.15 rmec-importer/1.0",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
    })
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError) as e:
            status = getattr(e, "code", None)
            if (status is not None and status < 500 and status != 429) or attempt == retries - 1:
                raise
            time.sleep(2 ** attempt * 2)


def fetch_results(link: str) -> list[dict]:
    series, year, event = parse_link(link)
    base = f"https://www.moto-tally.com/{series}/Results.aspx/{year}/{event}"
    source = f"MotoTally {series} {year}/{event}"
    classes = class_options(parse_page(_get(base)))
    if not classes:
        raise ValueError(f"No classes found on {base} (results may not be posted yet).")
    results = []
    empty = []
    for code, name in classes:
        text = _get(f"{base}/{code}/S")
        rows = parse_class_page(text, name, source=source, key_prefix=f"mototally/{series}/{year}/{event}/{code}")
        if not rows:
            empty.append((code, name, text))
        results.extend(rows)
        time.sleep(0.3)  # be polite to their server
    if empty:
        # Save what MotoTally sent for an empty class so the reader can be fixed if the page changed.
        folder = os.path.join(os.path.dirname(os.path.abspath(__file__)), "debug")
        os.makedirs(folder, exist_ok=True)
        code, name, text = empty[0]
        path = os.path.join(folder, f"mototally_{series}_{year}_{event}_{code}.html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"  note: {len(empty)} MotoTally classes had no readable results "
              f"({', '.join(n for _, n, _ in empty[:5])}{'…' if len(empty) > 5 else ''}); saved {path}")
    return results


def event_title(link: str) -> str:
    series, year, event = parse_link(link)
    page = parse_page(_get(f"https://www.moto-tally.com/{series}/Results.aspx/{year}/{event}"))
    return html_lib.unescape(page.title).split(">")[-2].strip() if ">" in page.title else page.title
