"""Convert the official 2021 Shenzhen community reference-price PDF to JS."""

import argparse
import json
import re
from pathlib import Path

from pypdf import PdfReader


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    args = parser.parse_args()

    rows = []
    for page in PdfReader(args.pdf).pages:
        for line in page.extract_text(extraction_mode="layout").splitlines():
            if not re.match(r"^\s*\d+\s", line):
                continue
            number, district, street, value = re.split(r"\s{2,}", line.strip(), maxsplit=3)
            name, price = re.fullmatch(r"(.+?)\s{2,}(\d+)", value).groups()
            if int(number) != len(rows) + 1:
                raise ValueError(f"Unexpected row number {number}")
            rows.append([district, street, " ".join(name.split()), int(price)])

    if len(rows) != 3595:
        raise ValueError(f"Expected 3,595 rows, found {len(rows)}")

    output = Path(__file__).resolve().parents[1] / "docs" / "community-data.js"
    records = ",\n".join("  " + json.dumps(row, ensure_ascii=False) for row in rows)
    output.write_text(
        "// 深圳市住宅小区二手住房成交参考价格表（2021-02-08）\n"
        "// https://zjj.sz.gov.cn/attachment/0/749/749839/8545737.pdf\n"
        f"window.COMMUNITY_REFERENCE_ROWS = [\n{records}\n];\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
