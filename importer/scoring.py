"""Class and division points.

A line-by-line port of the "Calculate & Validate Points" node in the n8n
"Calculate Race Points" workflow, so the rules match what was already built:

* Points table: 30, 25, 21, 18, 16, 15, 14 ... 1 for 1st-20th; 0 after that.
* DNS / DNF / disqualified results get 0 class and 0 division points.
* Adult classes are classes with a division_id; classes without one are Junior.
* Division points (only for divisions with has_annual_points) rank eligible
  riders in the division by LiveLaps overall_position, using the same table.
* The division winner gets 36 class points; the rest of that class shift up
  one place before the table is applied.
* Anything inconsistent (missing/duplicate positions, DNF ranked ahead of a
  finisher, etc.) is an error and blocks the update instead of guessing.
"""

from __future__ import annotations

POINTS_TABLE = {1: 30, 2: 25, 3: 21, 4: 18, 5: 16, 6: 15, 7: 14, 8: 13, 9: 12, 10: 11,
                11: 10, 12: 9, 13: 8, 14: 7, 15: 6, 16: 5, 17: 4, 18: 3, 19: 2, 20: 1}
DIVISION_WINNER_POINTS = 36


def table_points(place) -> int:
    return POINTS_TABLE.get(place, 0) if _pos_int(place) else 0


def _pos_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and v >= 1


def calculate(event_id, results, event, classes, divisions, series):
    errors: list[str] = []
    warnings: list[str] = []

    if not event_id:
        errors.append("No event_id selected.")
    if not event:
        errors.append(f"Event {event_id} was not found in the events table.")
    elif not event.get("series_id"):
        errors.append(f"Event {event_id} has no series_id.")
    if not results:
        errors.append(f"No results found for event {event_id}.")

    class_map = {c["id"]: c for c in classes}
    div_map = {d["id"]: d for d in divisions}
    series_map = {s["id"]: s for s in series}

    # Expected series: the event's series (Adult) plus sibling series in the same season (e.g. Junior).
    allowed_series: set = set()
    if event and event.get("series_id"):
        es = series_map.get(event["series_id"])
        if not es:
            errors.append(f"Event series_id {event['series_id']} not found in series table.")
        else:
            allowed_series.add(es["id"])
            for s in series_map.values():
                if s.get("season_id") and s["season_id"] == es.get("season_id"):
                    allowed_series.add(s["id"])

    series_has_divisions = bool(event) and any(d.get("series_id") == event.get("series_id") for d in divisions)

    recs, seen = [], set()
    for r in results:
        tag = f"result {r['id']}"
        if r["id"] in seen:
            errors.append(f"Duplicate result id {r['id']} retrieved.")
            continue
        seen.add(r["id"])
        if r.get("event_id") != event_id:
            errors.append(f"{tag} belongs to event {r.get('event_id')}, not the selected event.")
        if not r.get("rider_id"):
            errors.append(f"{tag} has no rider_id.")

        cls = class_map.get(r.get("class_id"))
        category = div = None
        if not r.get("class_id"):
            errors.append(f"{tag} has no class_id.")
        elif not cls:
            errors.append(f"{tag} class_id {r['class_id']} not found in classes table.")
        else:
            if not cls.get("series_id"):
                errors.append(f"Class {cls['name']} ({cls['id']}) has no series_id.")
            elif cls["series_id"] not in allowed_series:
                errors.append(f"Class {cls['name']} series {cls['series_id']} is not part of the expected series for this event.")
            if cls.get("division_id"):
                category = "Adult"
                div = div_map.get(cls["division_id"])
                if not div:
                    errors.append(f"Adult class {cls['name']} has division_id {cls['division_id']} that does not exist.")
                elif div.get("series_id") != cls.get("series_id"):
                    errors.append(f"Class {cls['name']} division {div['name']} belongs to a different series.")
                if event and cls.get("series_id") != event.get("series_id"):
                    errors.append(f"Adult class {cls['name']} is not in the event series.")
            else:
                category = "Junior"
                # Only a problem in a series that uses divisions (Adult); Junior events have none.
                if event and cls.get("series_id") == event.get("series_id") and series_has_divisions:
                    errors.append(f"Class {cls['name']} is in the Adult series but has no division assignment.")

        status = []
        for f in ("dns", "dnf", "disqualified"):
            if r.get(f) is True:
                status.append(f.upper())
            elif r.get(f) is not False:
                warnings.append(f"{tag} has non-boolean {f} value ({r.get(f)!r}); treated as false.")
        if len(status) > 1:
            warnings.append(f"{tag} has multiple status flags: {', '.join(status)}.")
        standing = r.get("standing")
        if status and standing == "Scored":
            errors.append(f"{tag} is flagged {'/'.join(status)} but standing is \"Scored\" (conflicting status).")
        if not status and standing and standing != "Scored":
            errors.append(f"{tag} has standing \"{standing}\" but no DNS/DNF/DQ flag (conflicting status).")

        recs.append({
            "r": r, "cls": cls, "div": div, "category": category, "status": status,
            "eligible": not status,
            "annual": bool(div and div.get("has_annual_points") is True),
            "points": 0, "division_points": 0, "scoring_position": None,
            "division_rank": None, "is_division_winner": False,
        })

    # ---------- Position checks ----------
    by_class: dict = {}
    for x in recs:
        if x["cls"]:
            by_class.setdefault(x["cls"]["id"], []).append(x)

    for lst in by_class.values():
        cname = lst[0]["cls"]["name"]
        seen_pos = {}
        for x in lst:
            p = x["r"].get("position")
            if x["eligible"] and not _pos_int(p):
                errors.append(f"Missing/invalid class position for eligible result {x['r']['id']} in class {cname}.")
            if _pos_int(p):
                if p in seen_pos:
                    errors.append(f"Duplicate class position {p} in class {cname} (results {seen_pos[p]}, {x['r']['id']}).")
                else:
                    seen_pos[p] = x["r"]["id"]
        elig = [x for x in lst if x["eligible"] and _pos_int(x["r"].get("position"))]
        inelig = [x for x in lst if not x["eligible"] and _pos_int(x["r"].get("position"))]
        for i in inelig:
            for e in elig:
                if i["r"]["position"] < e["r"]["position"]:
                    errors.append(
                        f"In class {cname}, {'/'.join(i['status'])} result {i['r']['id']} (pos {i['r']['position']}) "
                        f"is ranked ahead of eligible result {e['r']['id']} (pos {e['r']['position']})."
                    )
        ann = sorted((x for x in elig if x["annual"] and _pos_int(x["r"].get("overall_position"))),
                     key=lambda x: x["r"]["position"])
        for a, b in zip(ann, ann[1:]):
            if b["r"]["overall_position"] < a["r"]["overall_position"]:
                errors.append(f"Class {cname}: class position order conflicts with overall_position (results {a['r']['id']}, {b['r']['id']}).")

    seen_overall = {}
    for x in recs:
        op = x["r"].get("overall_position")
        if x["eligible"] and x["annual"] and not _pos_int(op):
            errors.append(f"Missing/invalid overall_position for eligible Adult result {x['r']['id']} (needed for division ranking).")
        if _pos_int(op):
            if op in seen_overall:
                errors.append(f"Duplicate overall_position {op} (results {seen_overall[op]}, {x['r']['id']}).")
            else:
                seen_overall[op] = x["r"]["id"]

    # ---------- Step 1: division order and winners (annual divisions only) ----------
    by_div: dict = {}
    for x in recs:
        if x["eligible"] and x["annual"] and _pos_int(x["r"].get("overall_position")):
            by_div.setdefault(x["div"]["id"], []).append(x)
    winners = []
    for lst in by_div.values():
        lst.sort(key=lambda x: x["r"]["overall_position"])
        for idx, x in enumerate(lst):
            x["division_rank"] = idx + 1
            x["division_points"] = table_points(idx + 1)
        w = lst[0]
        w["is_division_winner"] = True
        winners.append({"division": w["div"]["name"], "result_id": w["r"]["id"], "rider_id": w["r"]["rider_id"],
                        "class": w["cls"]["name"], "overall_position": w["r"]["overall_position"]})

    # ---------- Step 2: class points ----------
    for lst in by_class.values():
        elig = sorted((x for x in lst if x["eligible"] and _pos_int(x["r"].get("position"))),
                      key=lambda x: x["r"]["position"])
        cname = lst[0]["cls"]["name"]
        class_winners = [x for x in elig if x["is_division_winner"]] if lst[0]["category"] == "Adult" else []
        if len(class_winners) > 1:
            errors.append(f"Class {cname} contains more than one division winner.")
        if len(class_winners) == 1 and elig[0] is not class_winners[0]:
            errors.append(f"Division winner {class_winners[0]['r']['id']} is not first among eligible riders in class {cname}.")
        rank = 0
        for x in elig:
            if x in class_winners:
                x["points"] = DIVISION_WINNER_POINTS
                continue
            rank += 1
            x["scoring_position"] = rank
            x["points"] = table_points(rank)

    # ---------- Validation ----------
    for x in recs:
        rid = x["r"]["id"]
        if x["category"] == "Junior" and (x["points"] == DIVISION_WINNER_POINTS or x["is_division_winner"] or x["division_points"]):
            errors.append(f"Junior result {rid} received Adult bonus or division points.")
        if x["category"] == "Adult" and not x["annual"] and (x["division_points"] or x["points"] == DIVISION_WINNER_POINTS):
            errors.append(f"Non-annual division result {rid} ({x['div']['name'] if x['div'] else '?'}) received division points or bonus.")
        if not x["eligible"] and (x["points"] or x["division_points"]):
            errors.append(f"Ineligible result {rid} received points.")

    proposed = sorted(
        ({
            "id": x["r"]["id"],
            "rider_id": x["r"].get("rider_id"),
            "class_name": x["cls"]["name"] if x["cls"] else None,
            "category": x["category"],
            "division": x["div"]["name"] if x["div"] else None,
            "status": "/".join(x["status"]) or "Eligible",
            "position": x["r"].get("position"),
            "overall_position": x["r"].get("overall_position"),
            "is_division_winner": x["is_division_winner"],
            "class_scoring_position": x["scoring_position"],
            "division_rank": x["division_rank"],
            "points": x["points"],
            "division_points": x["division_points"],
            "current_points": x["r"].get("points"),
            "current_division_points": x["r"].get("division_points"),
        } for x in recs),
        key=lambda p: (p["division"] or "zz", str(p["class_name"]), p["position"] or 999),
    )

    summary = {
        "event_name": event.get("name") if event else None,
        "results": len(results),
        "adult": sum(x["category"] == "Adult" for x in recs),
        "junior": sum(x["category"] == "Junior" for x in recs),
        "division_winners": len(winners),
        "excluded_dns_dnf_dq": sum(not x["eligible"] for x in recs),
        "errors": len(errors),
        "warnings": len(warnings),
    }
    return {"valid": not errors, "errors": errors, "warnings": warnings,
            "winners": winners, "proposed": proposed, "summary": summary}
