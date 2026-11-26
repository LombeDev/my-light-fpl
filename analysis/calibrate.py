#!/usr/bin/env python3
"""Suggests price-change thresholds from the site's logged price changes.

Usage, either of these:
    python3 analysis/calibrate.py https://my-light-fpl.pages.dev
    python3 analysis/calibrate.py path/to/folder

The folder option reads two saved files from that folder:
    events.json     (saved from /api/prices/events)
    calibrate.json  (saved from /api/prices/calibrate)

Needs Python 3.9 or newer. Uses only the standard library.
"""
import json
import pathlib
import statistics
import sys
import urllib.error
import urllib.request

# Ownership bands, matching the server's BANDS. Each band is [low, high) in percent.
BANDS = [
    ("under 5%", 0, 5),
    ("5% to 20%", 5, 20),
    ("20% to 50%", 20, 50),
    ("50% and over", 50, 101),
]

# Thresholds currently in use, keyed by the ownership level at the band's lower bound.
# Each value is (rise, fall), taken from the TIERS table in lib/prices.ts.
CURRENT = {
    0: (90000, 85000),
    5: (165000, 145000),
    20: (220000, 195000),
    50: (340000, 310000),
}


def fetch_url(url):
    """Fetch JSON from the site. Exits with a clear message if the site refuses the request."""
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) FPL-calibrate/1.0",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        sys.exit(
            f"The site refused the request ({url}): HTTP {err.code}.\n"
            "Save the page instead: open the link in a browser, copy all the text,\n"
            "save it as events.json or calibrate.json in a folder, and run the script\n"
            "with that folder instead of the site address."
        )
    except urllib.error.URLError as err:
        sys.exit(f"Could not reach {url}: {err.reason}")


def load_json_file(path):
    if not path.is_file():
        sys.exit(f"File not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def load_data(source):
    """Return (events, calibrate) from either a site address or a folder of saved files."""
    if source.startswith(("http://", "https://")):
        site = source.rstrip("/")
        events = fetch_url(f"{site}/api/prices/events").get("events", [])
        calibrate = fetch_url(f"{site}/api/prices/calibrate")
        return events, calibrate

    folder = pathlib.Path(source)
    if not folder.is_dir():
        sys.exit(f"Folder not found: {folder}")
    events = load_json_file(folder / "events.json").get("events", [])
    calibrate = load_json_file(folder / "calibrate.json")
    return events, calibrate


def discount(own):
    # The same chip discount the model applies: 0.92 above 25% ownership, otherwise 0.95.
    return 0.92 if own > 25 else 0.95


def current_for(low):
    value = CURRENT[0]
    for level, pair in sorted(CURRENT.items()):
        if low >= level:
            value = pair
    return value


def suggest(values):
    """The lower quartile of the effective net transfers that caused changes.

    Changes happen once the net passes the threshold, so the smallest typical
    cause is the best estimate of the threshold. Needs at least five samples.
    """
    if len(values) < 5:
        return None
    return round(statistics.quantiles(values, n=4)[0])


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    events, calibrate = load_data(sys.argv[1])

    # Only logged events have a net figure. Imported and gameweek rows do not.
    logged = [e for e in events if e.get("net") is not None and e.get("own") is not None]
    print(f"Logged changes with transfer data: {len(logged)}")
    if len(logged) < 20:
        print("Fewer than 20 logged changes. Treat these numbers as a rough guide only.\n")

    print(f"{'band':<14}{'dir':<7}{'n':>4}{'median':>12}{'suggested':>12}{'current':>12}")
    for label, lo, hi in BANDS:
        for dir_value, dir_name in ((1, "rise"), (-1, "fall")):
            vals = [
                abs(e["net"]) * discount(e["own"])
                for e in logged
                if e["dir"] == dir_value and lo <= e["own"] < hi
            ]
            if not vals:
                print(f"{label:<14}{dir_name:<7}{0:>4}{'-':>12}{'-':>12}{'-':>12}")
                continue
            rise, fall = current_for(lo)
            current = rise if dir_value == 1 else fall
            suggested = suggest(vals)
            print(
                f"{label:<14}{dir_name:<7}{len(vals):>4}"
                f"{round(statistics.median(vals)):>12,}"
                f"{(f'{suggested:,}' if suggested else '-'):>12}"
                f"{current:>12,}"
            )

    acc = calibrate.get("accuracy", {})
    print("\nAccuracy of the 95%+ alerts:")
    print(f"  price changes scored: {acc.get('changes')}")
    print(f"  precision (alerts that came true): {acc.get('precision')}%")
    print(f"  recall (changes we flagged): {acc.get('recall')}%")

    print(
        "\nNext step: send this output to the assistant. Bands with a suggested value"
        "\ndiffering from the current value by more than about 15% are candidates for"
        "\nchanging the TIERS table."
    )


if __name__ == "__main__":
    main()
