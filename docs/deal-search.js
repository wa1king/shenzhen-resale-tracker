(() => {
  "use strict";

  const get = (id) => document.getElementById("sales-" + id);
  const data = window.SHENZHEN_DEAL_SAMPLES;
  const chineseDigits = { 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 〇: "0" };
  const normalize = (value) => value.normalize("NFKC").toLowerCase()
    .replace(/[一二三四五六七八九〇]{4,}/g, (digits) => [...digits].map((digit) => chineseDigits[digit]).join(""))
    .replace(/[^\p{L}\p{N}]/gu, "");
  const number = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
  const pageSize = 12;
  const rows = (data?.rows ?? []).map(([community, district, neighborhood, date, layout, area, price, floor, source, communityUrl]) => ({
    community, district, neighborhood, date, layout, area, price, floor, source, communityUrl,
    key: normalize(community), room: Number(layout.match(/^(\d+)室/)?.[1] ?? 0), unit: price / area,
    auction: !communityUrl
  }));
  const orders = {
    date: (a, b) => b.date.localeCompare(a.date),
    unit: (a, b) => a.unit - b.unit,
    price: (a, b) => a.price - b.price
  };
  let page = 0;
  let matched = [];

  function options(field, values, all) {
    get(field).replaceChildren(new Option(all, ""), ...values.map(([value, label]) => new Option(label, value)));
  }

  function inRange(value, range) {
    if (!range) return true;
    const [lower, upper] = range.split(",");
    return value >= Number(lower) && (!upper || value < Number(upper));
  }

  function render() {
    const keyword = normalize(get("query").value.trim());
    const district = get("district").value;
    const month = get("month").value;
    const room = get("layout").value;
    const area = get("area").value;
    const price = get("price").value;
    const type = get("type").value;
    matched = rows.filter((row) =>
      (!keyword || row.key.includes(keyword) || (row.key.length >= 4 && keyword.includes(row.key))) &&
      (!district || row.district === district) &&
      (!type || row.auction === (type === "auction")) &&
      (!month || row.date.startsWith(month)) &&
      (!room || (room === "4" ? row.room >= 4 : row.room === Number(room))) &&
      inRange(row.area, area) && inRange(row.price / 10000, price)
    ).sort(orders[get("sort").value]);
    const first = page * pageSize;
    const tbody = get("results");
    tbody.replaceChildren();
    for (const row of matched.slice(first, first + pageSize)) {
      const tr = tbody.insertRow();
      tr.insertCell().textContent = row.date;
      const name = tr.insertCell();
      name.textContent = row.community;
      const location = document.createElement("small");
      location.className = "sales-row-detail";
      location.textContent = [row.district, row.neighborhood].filter(Boolean).join(" · ");
      name.append(location);
      tr.insertCell().textContent = [row.layout, row.floor].filter(Boolean).join(" · ") || "—";
      for (const value of [row.area, row.price / 10000, Math.round(row.unit)]) {
        const cell = tr.insertCell();
        cell.className = "numeric";
        cell.textContent = number.format(value);
      }
      const link = document.createElement("a");
      link.href = row.source;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = row.auction ? "法拍 · 公开报道 ↗" : "中原成交页 ↗";
      const attribution = tr.insertCell();
      attribution.append(link);
      if (row.communityUrl) {
        const community = document.createElement("a");
        community.className = "sales-row-detail";
        community.href = row.communityUrl;
        community.target = "_blank";
        community.rel = "noopener noreferrer";
        community.textContent = "中原小区页 ↗";
        attribution.append(community);
      }
    }
    if (!matched.length) {
      const cell = tbody.insertRow().insertCell();
      cell.colSpan = 7;
      cell.className = "empty";
      cell.textContent = "当前筛选没有收录样本。可尝试小区简称或放宽月份、户型和面积。";
    }
    const units = matched.map((row) => row.unit).sort((a, b) => a - b);
    const mid = Math.floor(units.length / 2);
    const median = units.length % 2 ? units[mid] : (units[mid - 1] + units[mid]) / 2;
    const auctions = matched.filter((row) => row.auction).length;
    const mixed = auctions > 0 && auctions < matched.length;
    get("summary").textContent = "匹配 " + number.format(matched.length) + " 条样本" + (mixed
      ? " · 普通成交 " + number.format(matched.length - auctions) + " 条 · 法拍 " + number.format(auctions) + " 条"
      : matched.length ? " · 样本单价中位数 " + number.format(Math.round(median)) + " 元/㎡" : "");
    get("page").textContent = matched.length ? (first + 1) + "–" + Math.min(first + pageSize, matched.length) + " / " + number.format(matched.length) : "共 0 条";
    get("prev").disabled = page === 0;
    get("next").disabled = first + pageSize >= matched.length;
    get("export").disabled = matched.length === 0;
  }

  function reset() {
    page = 0;
    render();
  }

  function exportCsv() {
    const headings = ["成交日期", "小区", "区", "片区", "户型", "楼层", "面积（㎡）", "总价（元）", "单价（元/㎡）", "交易类型", "来源", "来源链接", "小区链接"];
    const values = matched.map((row) => [row.date, row.community, row.district, row.neighborhood, row.layout,
      row.floor, row.area, row.price, Math.round(row.unit), row.auction ? "法拍" : "普通二手房",
      row.auction ? "公开报道" : "深圳中原成交样本", row.source, row.communityUrl]);
    const csv = [headings, ...values].map((line) => line.map((value) => {
      const field = String(value);
      const safe = /^[=+@\-]/.test(field) ? "'" + field : field;
      return '"' + safe.replaceAll('"', '""') + '"';
    }).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "深圳逐套成交样本.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const districts = [...new Set(rows.map((row) => row.district))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const months = [...new Set(rows.map((row) => row.date.slice(0, 7)))].sort().reverse();
  const span = rows.length ? rows.at(-1).date + " 至 " + rows[0].date : "";
  get("coverage").textContent = rows.length
    ? span + " · " + districts.length + " 区 · " + number.format(rows.length) + " 条 · 收录于 " + data.asOf
    : "暂无已收录样本";
  options("district", districts.map((value) => [value, value]), "全部区域");
  options("layout", [["1", "一室"], ["2", "二室"], ["3", "三室"], ["4", "四室及以上"]], "全部户型");
  options("month", months.map((value) => [value, value]), "全部月份");
  get("query").addEventListener("input", reset);
  for (const id of ["district", "layout", "area", "price", "month", "sort", "type"]) get(id).addEventListener("change", reset);
  get("prev").addEventListener("click", () => { if (page > 0) page--; render(); });
  get("next").addEventListener("click", () => { if ((page + 1) * pageSize < matched.length) page++; render(); });
  get("export").addEventListener("click", exportCsv);
  document.addEventListener("lookup-community-sales", ({ detail }) => {
    get("query").value = detail;
    for (const id of ["district", "layout", "area", "price", "month", "type"]) get(id).value = "";
    reset();
    location.hash = "sales";
    get("query").focus({ preventScroll: true });
  });
  render();
})();
