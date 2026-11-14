"""Collect Shenzhen resale observations from Centaline's public result pages."""

import argparse
import calendar
import json
import re
import sqlite3
import time
from datetime import date
from decimal import Decimal
from html import unescape
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import Request, urlopen


BASE = "https://sz.centanet.com"
DISTRICTS = {"福田", "罗湖", "南山", "龙岗", "宝安", "龙华", "盐田", "光明", "坪山", "大鹏新区", "大鹏", "深汕"}
DISTRICT_PAGES = ("longhua", "baoan", "longgang", "luohu", "futian", "nanshan", "yantian", "guangming", "pingshan", "dapeng")
ROOT = Path(__file__).resolve().parents[1]
FIELDS = ("community", "district", "neighborhood", "date", "layout", "area", "price", "floor", "source_url", "community_url")
BLOCK = re.compile(r'<div class="estate-item clearfix">(.*?)(?=<div class="estate-item clearfix">|<p class="tl f999 mt_10">)', re.S)


def plain(markup):
    return " ".join(unescape(re.sub(r"<[^>]*>", "", markup)).split())


def read_page(page, district=""):
    prefix = "/chengjiao/" + (district + "/" if district else "")
    url = BASE + prefix + (f"g{page}/" if page > 1 else "")
    request = Request(url, headers={"User-Agent": "ChatGPT-User"})
    with urlopen(request, timeout=12) as response:
        if response.status != 200:
            raise ValueError(f"Unexpected response {response.status}: {url}")
        markup = response.read().decode("utf-8")
    blocks = BLOCK.findall(markup)
    if not blocks:
        if district and page == 1 and "成交记录" in markup:
            return [], False
        raise ValueError(f"No public deal rows: {url}")
    rows = []
    for block in blocks:
        title = re.search(r'<h4 class="house-title">\s*<a href="([^"]+)"[^>]*>([^<]+)</a>', block)
        layout_block = re.search(r'<p class=[\'"]house-name[^\'"]*[\'"]>(.*?)</p>', block, re.S)
        location = re.search(r'<p class="house-txt house-txtB">(.*?)</p>', block, re.S)
        center = re.search(r'<p class="house-txt fl\s+house-center">(.*?)</p>', block, re.S)
        price = re.search(r'<p class="price-nub[^"]*">\s*<span>([\d.]+)万</span>', block)
        if not all((title, layout_block, location, center, price)):
            continue
        layout = plain(layout_block[1]).split("|")
        size = re.fullmatch(r"([\d.]+)平", layout[-1].strip())
        district, _, neighborhood = plain(location[1]).partition("-")
        when = re.search(r"\d{4}/\d{2}/\d{2}", center[1])
        if not size or not when or len(layout) != 2 or district.strip() not in DISTRICTS:
            continue
        floor = re.search(r"[低中高底顶]层(?:\s*\(\d+层\))?", plain(center[1]))
        area = float(size[1])
        amount = int(Decimal(price[1]) * 10000)
        if area <= 0 or amount <= 0:
            continue
        community_url = urljoin(BASE, title[1])
        if not community_url.startswith(BASE + "/xiaoqu/"):
            continue
        rows.append((
            plain(title[2]), district.strip(), neighborhood.strip(), date.fromisoformat(when[0].replace("/", "-")).isoformat(),
            layout[0].strip(), area, amount, floor[0] if floor else "", url, community_url,
        ))
    if len(rows) < len(blocks) // 2:
        raise ValueError(f"Too few usable records: {url}")
    return rows, bool(re.search(r">\s*下一页\s*</a>", markup))


def collect(since, until, pages, district):
    previous = None
    for page in range(1, pages + 1):
        try:
            current, more = read_page(page, district)
        except (ValueError, OSError) as error:
            raise SystemExit(f"{district or 'city'} page {page}: {error}. Existing snapshot retained.") from error
        if not current:
            break
        page_signature = [row[:8] + (row[9],) for row in current]
        if page_signature == previous:
            raise SystemExit(f"{district or 'city'} page {page} repeated the preceding page.")
        previous = page_signature
        yield from (row for row in current if since <= row[3] <= until)
        if not more or max(row[3] for row in current) < since:
            break
        time.sleep(0.8)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--as-of", type=date.fromisoformat, required=True)
    parser.add_argument("--pages", type=int, default=100)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--district-only", action="store_true", help="Add district-level samples to an existing city snapshot")
    mode.add_argument("--export-only", action="store_true", help="Merge local auction results and export without fetching")
    args = parser.parse_args()
    if not 1 <= args.pages <= 100:
        parser.error("--pages must be within 1–100")
    prior_year = args.as_of.year - 1
    last_day = calendar.monthrange(prior_year, args.as_of.month)[1]
    since = args.as_of.replace(year=prior_year, day=min(args.as_of.day, last_day))
    rows = []
    if (args.district_only or args.export_only) and not args.database.is_file():
        parser.error("This mode requires an existing database")
    pages = () if args.export_only else DISTRICT_PAGES if args.district_only else ("", *DISTRICT_PAGES)
    for district in pages:
        found = list(collect(since.isoformat(), args.as_of.isoformat(), args.pages, district))
        rows.extend(found)
        print(f"{district or 'city'}: {len(found)} candidate observations", flush=True)

    if not rows and not args.export_only:
        raise SystemExit("No recent Shenzhen observations")
    auction_file = Path(__file__).with_name("published-auction-results.json")
    auctions = json.loads(auction_file.read_text(encoding="utf-8"))
    rows.extend(row for row in auctions if since.isoformat() <= row[3] <= args.as_of.isoformat())
    with sqlite3.connect(args.database) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS resale_samples (
          community TEXT, district TEXT, neighborhood TEXT, date TEXT, layout TEXT,
          area REAL, price INTEGER, floor TEXT, source_url TEXT, community_url TEXT,
          UNIQUE(community_url, district, date, layout, area, price, floor)
        )""")
        db.executemany("""INSERT INTO resale_samples VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(community_url, district, date, layout, area, price, floor)
          DO UPDATE SET source_url = excluded.source_url""", rows)
        result = db.execute("""SELECT * FROM resale_samples WHERE date BETWEEN ? AND ?
          ORDER BY date DESC, district, community, area, price, floor""", (since.isoformat(), args.as_of.isoformat())).fetchall()

    if not result:
        raise SystemExit("No observations in the requested date window")
    snapshot = {"asOf": args.as_of.isoformat(), "fields": FIELDS, "rows": result}
    output = ROOT / "docs" / "deal-samples.js"
    temporary = output.with_suffix(".tmp")
    temporary.write_text("window.SHENZHEN_DEAL_SAMPLES = " + json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    temporary.replace(output)
    print(f"{len(result)} observations, {result[-1][3]} to {result[0][3]}, {len({row[1] for row in result})} districts", flush=True)


if __name__ == "__main__":
    main()
