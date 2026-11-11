"""Merge the anonymous Shenzhen government preview into the site's daily records."""

import json
import math
import re
import subprocess
import sys
import tempfile
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urlencode


BASE_URL = "https://opendata.sz.gov.cn"
RESOURCE_ID = "29200/01903513"
DATASET_URL = f"{BASE_URL}/data/dataSet/toDataDetails/29200_01903513"
OUTPUT_PATH = Path(__file__).resolve().parents[1] / "docs" / "official-daily.js"
DISTRICTS = {
    "全市": "全市",
    "福田": "福田区",
    "罗湖": "罗湖区",
    "盐田": "盐田区",
    "南山": "南山区",
    "宝安": "宝安区",
    "龙岗": "龙岗区",
    "龙华": "龙华区",
    "坪山": "坪山区",
    "光明": "光明区",
    "大鹏": "大鹏新区",
    "深汕": "深汕特别合作区",
}
DISTRICTS.update({district: district for district in DISTRICTS.values()})


def read_public_json(path, params, post=False):
    url = BASE_URL + path
    encoded = urlencode(params)
    options = ["curl", "--proto", "=https", "--fail", "--silent", "--show-error", "--max-time", "15"]
    if post:
        options.extend(("--data", encoded))
    else:
        url += "?" + encoded
    response = subprocess.check_output([*options, url], timeout=20)
    return json.loads(response)


def fetch_preview():
    metadata = read_public_json(
        "/data/catalog/selectDataCatalogByResId", {"resId": RESOURCE_ID}, post=True
    )
    if metadata["openLevelName"] != "无条件开放":
        raise ValueError("数据集不再显示为无条件开放")
    table = metadata["sourceTableName"]
    if not re.fullmatch(r"[A-Za-z0-9_]+", table):
        raise ValueError("官方预览表名格式已变更")
    updated = datetime.strptime(metadata["dataUpdateTime"], "%Y-%m-%d %H:%M:%S")
    preview = read_public_json(
        "/data/dataSet/getPreviewData", {"tableName": table, "resId": RESOURCE_ID}
    )
    if not isinstance(preview, list):
        raise ValueError("官方预览响应格式已变更")

    rows = {}
    for raw in preview:
        if raw["HOUSE_USAGE2"] != "住宅":
            continue
        transaction_date = date.fromisoformat(raw["TJ_DATE"]).isoformat()
        district = DISTRICTS[raw["ZONE"]]
        count, area = raw["CJ_NUM"], raw["CJ_AREA"]
        if type(count) is not int or count < 0:
            raise ValueError("官方预览包含无效的成交套数")
        if type(area) not in (int, float) or not math.isfinite(area) or area < 0:
            raise ValueError("官方预览包含无效的成交面积")
        row = {
            "date": transaction_date,
            "district": district,
            "count": count,
            "area": area,
            "kind": "daily",
            "source": "official-daily",
        }
        key = (transaction_date, district)
        if key in rows and rows[key] != row:
            raise ValueError(f"官方预览中同一日期和区域存在不同数值 {transaction_date} {district}")
        rows[key] = row
    if not rows:
        raise ValueError("官方预览没有可用的住宅记录")
    return updated, len(preview), rows


def merge_preview(updated, preview_count, preview):
    original = OUTPUT_PATH.read_text(encoding="utf-8") if OUTPUT_PATH.exists() else ""
    existing = {}
    if original:
        previous_update = re.search(r"Source update \(China Standard Time\): ([0-9 :\-]+)", original)
        if previous_update and updated < datetime.strptime(previous_update.group(1), "%Y-%m-%d %H:%M:%S"):
            raise ValueError("官方预览早于已保存的版本")
        match = re.search(r"^window\.DAILY_ROWS = (\[.*?\]);\s*$", original, re.MULTILINE | re.DOTALL)
        if not match:
            raise ValueError("站点日度数据文件格式已变更")
        for row in json.loads(match.group(1)):
            if row["kind"] != "daily" or row["source"] != "official-daily":
                raise ValueError("站点日度数据文件含其他来源")
            existing[(row["date"], row["district"])] = row

    existing.update(preview)
    rows = sorted(existing.values(), key=lambda row: (row["date"], row["district"] != "全市", row["district"]))
    formatted = ",\n".join("  " + json.dumps(row, ensure_ascii=False, separators=(",", ":")) for row in rows)
    result = (
        f"// Shenzhen Government Open Data: {DATASET_URL}\n"
        f"// Source update (China Standard Time): {updated:%Y-%m-%d %H:%M:%S}.\n"
        f"// Archive of public previews. Latest preview returned {preview_count} rows across all uses.\n"
        "// Residential rows only. District coverage may be partial. Missing rows represent unknowns.\n"
        f"window.DAILY_ROWS = [\n{formatted}\n];\n"
    )
    if result != original:
        temporary_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", newline="\n", dir=OUTPUT_PATH.parent, delete=False
            ) as temporary:
                temporary_path = Path(temporary.name)
                temporary.write(result)
            temporary_path.replace(OUTPUT_PATH)
        finally:
            if temporary_path:
                temporary_path.unlink(missing_ok=True)
    return len(rows)


def main():
    try:
        updated, preview_count, preview = fetch_preview()
        total = merge_preview(updated, preview_count, preview)
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as exc:
        print(f"更新失败，原日度数据已保留：{exc}", file=sys.stderr)
        return 1
    print(f"官方数据更新于 {updated}。本次预览住宅记录 {len(preview)} 条，累计保留 {total} 条。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
