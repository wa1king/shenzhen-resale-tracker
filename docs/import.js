(() => {
  "use strict";

  const officialFields = {
    date: "tj_date",
    district: "zone",
    usage: "house_usage2",
    count: "cj_num",
    area: "cj_area",
  };
  const chineseFields = {
    date: "日期",
    district: "所属区",
    usage: "用途",
    count: "成交套数",
    area: "成交面积",
  };

  const districts = new Map(
    ["福田", "罗湖", "南山", "盐田", "宝安", "龙岗", "龙华", "坪山", "光明"]
      .flatMap((name) => [[name, `${name}区`], [`${name}区`, `${name}区`]]),
  );
  for (const [name, aliases] of [
    ["全市", ["全市", "深圳市"]],
    ["大鹏新区", ["大鹏新区", "大鹏", "大鹏区"]],
    ["深汕特别合作区", ["深汕特别合作区", "深汕", "深汕合作区", "深汕区"]],
  ]) {
    for (const alias of aliases) districts.set(alias, name);
  }

  function clean(value) {
    return String(value ?? "").normalize("NFKC").trim();
  }

  function header(value) {
    return clean(value).toLowerCase().replace(/\s+/g, "");
  }

  function parseCsv(text) {
    const records = [];
    let row = [];
    let value = "";
    let quoted = false;
    let closed = false;

    function nextField() {
      row.push(value);
      value = "";
      closed = false;
    }

    function nextRow() {
      nextField();
      if (row.some((entry) => clean(entry))) records.push(row);
      row = [];
    }

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          value += char;
          i++;
        } else if (char === '"') {
          quoted = false;
          closed = true;
        } else {
          value += char;
        }
      } else if (char === ",") {
        nextField();
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[i + 1] === "\n") i++;
        nextRow();
      } else if (char === '"' && !value.trim() && !closed) {
        quoted = true;
        value = "";
      } else if (!closed) {
        if (char === '"') throw new Error("CSV 中有位置不正确的引号。");
        value += char;
      } else if (!/\s/.test(char)) {
        throw new Error("CSV 中的引号后应接逗号或换行。");
      }
    }
    if (quoted) throw new Error("CSV 中有未闭合的引号。");
    nextRow();
    if (records.length < 2) throw new Error("CSV 需要表头和至少一行数据。");

    const [headers, ...rows] = records;
    const keys = headers.map(header);
    return rows.map((cells) => {
      if (cells.length > keys.length) return null;
      return Object.fromEntries(keys.map((key, index) => [key, cells[index]]));
    });
  }

  function findJsonRows(value, depth = 0) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object" || depth >= 5) return null;
    const wrappers = ["rows", "records", "data", "list", "result", "results"];
    for (const key of wrappers) {
      const child = Object.keys(value).find((candidate) => header(candidate) === key);
      if (child === undefined) continue;
      const rows = findJsonRows(value[child], depth + 1);
      if (rows) return rows;
    }
    return null;
  }

  function parseDate(raw) {
    const match = /^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})日?)?月?(?:(?:T|\s)\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(clean(raw));
    if (!match) return null;
    const [, year, month, day] = match;
    if (+year < 1900 || +month < 1 || +month > 12) return null;
    const period = `${year}-${month.padStart(2, "0")}`;
    if (day === undefined) return null;
    const lastDay = new Date(Date.UTC(+year, +month, 0)).getUTCDate();
    if (+day < 1 || +day > lastDay) return null;
    return `${period}-${day.padStart(2, "0")}`;
  }

  function parseNumber(raw) {
    const value = clean(raw);
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) return null;
    const number = Number(value.replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
  }

  function detectSchema(records) {
    const keys = new Set(records.flatMap((row) => row ? Object.keys(row) : []));
    return [officialFields, chineseFields].find((fields) =>
      Object.values(fields).every((key) => keys.has(key)),
    );
  }

  function normalizeRow(row, fields) {
    if (!row || clean(row[fields.usage]) !== "住宅") return null;

    const date = parseDate(row[fields.date]);
    const district = districts.get(clean(row[fields.district]));
    const count = parseNumber(row[fields.count]);
    const rawArea = row[fields.area];
    const area = clean(rawArea) ? parseNumber(rawArea) : null;
    if (!date || !district || !Number.isSafeInteger(count) || (clean(rawArea) && area === null)) {
      return null;
    }

    return { date, district, count, area, kind: "daily" };
  }

  window.parseHousingFile = function parseHousingFile(text, filename = "") {
    const contents = text.replace(/^\uFEFF/, "").trim();
    if (!contents) throw new Error("文件是空的。");
    let records;
    if (/\.json$/i.test(filename) || contents.startsWith("{") || contents.startsWith("[")) {
      let value;
      try {
        value = JSON.parse(contents);
      } catch {
        throw new Error("无法读取 JSON，请检查文件格式。");
      }
      records = findJsonRows(value)?.map((row) =>
        row && typeof row === "object" && !Array.isArray(row)
          ? Object.fromEntries(Object.entries(row).map(([key, value]) => [header(key), value]))
          : null,
      );
    } else {
      records = parseCsv(contents);
    }
    if (!records?.length) throw new Error("文件中没有可读取的成交记录。");

    const fields = detectSchema(records);
    if (!fields) throw new Error("文件字段与深圳市住建局的日度成交数据集不符。请导入该数据集下载的原始 CSV 或 JSON 文件。");

    const rows = new Map();
    for (const record of records) {
      const row = normalizeRow(record, fields);
      if (row) rows.set(`${row.date}|${row.district}`, row);
    }
    if (!rows.size) {
      throw new Error("没有可导入的住宅记录。请检查文件是否包含用途为住宅且日期、区域、成交套数有效的日度记录。");
    }
    return { rows: [...rows.values()], skipped: records.length - rows.size };
  };
})();
