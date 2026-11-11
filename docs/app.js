"use strict";

const byId = (id) => document.getElementById(id);
const setText = (id, value) => { byId(id).textContent = value; };
const intFormat = new Intl.NumberFormat("zh-CN");
const areaFormat = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const wholeCity = "全市";
const storageKey = "shenzhen-resale-official-rows-v2";
const pageSize = 8;
const officialUrl = "https://opendata.sz.gov.cn/data/dataSet/toDataDetails/29200_01903513";
const sources = {
  "official-daily": {
    label: "深圳市住建局 · 公开预览",
    title: "深圳市住房和建设局 · 二手房成交信息（按日统计）",
    url: officialUrl,
    detail: "从官方公开预览收录可查记录。包含全市与部分行政区，筛选用途为住宅。"
  },
  "official-import": {
    label: "住建局开放数据 · 本机导入", url: officialUrl,
    title: "深圳市政府开放数据 · 文件导入",
    detail: "导入的文件按官方字段校验。请从该数据集下载原始文件，导入内容仅保存在当前浏览器。"
  },
  "daily-aggregate": {
    label: "住建局日数据汇总", url: officialUrl,
    title: "深圳市住建局 · 日数据汇总规则",
    detail: "自然周从周一到周日。只汇总已结束且有完整日期记录的周和月。已收录的官方月度套数优先显示。"
  },
  ...window.OFFICIAL_PERIOD_SOURCES
};
const sourceFor = (row) => sources[row.source];
const builtInRows = [...(window.OFFICIAL_PERIOD_ROWS ?? []), ...(window.DAILY_ROWS ?? [])];
const granularity = {
  daily: { label: "日期", name: "每日", count: "当日成交", change: "较前一日", compare: "较上周同日", previous: -1, second: -7, options: [7, 14, 30], unit: "天" },
  weekly: { label: "自然周", name: "每周", count: "当周成交", change: "较上周", compare: "较 4 周前", previous: -7, second: -28, options: [4, 8, 12], unit: "周" },
  monthly: { label: "月份", name: "每月", count: "当月成交", change: "较上月", compare: "较去年同月", previous: -1, second: -12, options: [6, 12, 24], unit: "个月" }
};
const state = { kind: "daily", district: wholeCity, date: "", metric: "count", ranges: { daily: 7, weekly: 8, monthly: 12 }, page: 0 };
let importedRows = loadImports();
let records = new Map();
let visibleDetails = [];
let chartPoints = [];
let chartRegions = [];
let toastTimer;

function loadImports() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}

function rowKey(row) {
  return [row.kind, row.date, row.district].join("|");
}

function formatDate(date) {
  if (!date) return "—";
  const [year, month, day] = date.split("-").map(Number);
  return year + "年" + month + "月" + (day ? day + "日" : "");
}

function formatPeriod(date) {
  if (!date || state.kind !== "weekly") return formatDate(date);
  const [, month, day] = shift(date, 6).split("-").map(Number);
  return formatDate(date) + " 至 " + month + "月" + day + "日";
}

function shift(date, amount) {
  const [year, month, day] = date.split("-").map(Number);
  if (day) return new Date(Date.UTC(year, month - 1, day + amount)).toISOString().slice(0, 10);
  return new Date(Date.UTC(year, month - 1 + amount, 1)).toISOString().slice(0, 7);
}

function shenzhenDate() {
  const current = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts();
  const get = (type) => current.find((part) => part.type === type).value;
  return [get("year"), get("month"), get("day")].join("-");
}

function startOfWeek(date) {
  const day = new Date(date + "T00:00:00Z").getUTCDay();
  return shift(date, -((day + 6) % 7));
}

function aggregatePeriods(rows) {
  const groups = new Map();
  const today = shenzhenDate();
  for (const row of rows.values()) {
    if (row.kind !== "daily") continue;
    const month = row.date.slice(0, 7);
    const week = startOfWeek(row.date);
    const periods = [
      { kind: "monthly", date: month, closed: month < today.slice(0, 7) },
      { kind: "weekly", date: week, closed: shift(week, 6) < today }
    ];
    for (const { kind, date, closed } of periods) {
      if (!closed) continue;
      const key = rowKey({ kind, date, district: row.district });
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
  }
  for (const [key, group] of groups) {
    const [kind, date, district] = key.split("|");
    const [year, month] = date.split("-").map(Number);
    const dayCount = kind === "weekly" ? 7 : new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (group.length !== dayCount) continue;
    const count = group.reduce((sum, row) => sum + row.count, 0);
    const area = group.every((row) => row.area !== null)
      ? group.reduce((sum, row) => sum + row.area, 0)
      : null;
    const official = rows.get(key);
    if (official && (official.count !== count || official.area != null || area === null)) continue;
    rows.set(key, {
      date, district, kind, count, area, source: "daily-aggregate"
    });
  }
}

function rebuild() {
  records = new Map([...importedRows, ...builtInRows].map((row) => [rowKey(row), row]));
  aggregatePeriods(records);
}

function lookup(date, district = state.district) {
  return records.get(rowKey({ kind: state.kind, date, district }));
}

function availableRows() {
  return [...records.values()].filter((row) => row.kind === state.kind);
}

function selectOptions(select, values, selected) {
  select.replaceChildren(...values.map(([value, label]) => new Option(label, value, false, value === selected)));
  select.disabled = values.length === 0;
}

function change(value, baseline) {
  if (value == null || baseline == null || baseline === 0) return null;
  return Math.round((value / baseline - 1) * 1000) / 10;
}

function displayChange(id, value) {
  const node = byId(id);
  node.classList.toggle("up", value > 0);
  node.classList.toggle("down", value < 0);
  node.textContent = value === null ? "—" : (value > 0 ? "+" : "") + value.toFixed(1) + "%";
}

function renderSummary(dates) {
  const config = granularity[state.kind];
  const current = lookup(state.date);
  const prev = state.date && lookup(shift(state.date, config.previous));
  const annual = state.date && lookup(shift(state.date, config.second));
  setText("count-label", config.count);
  setText("change-label", config.change);
  setText("year-label", config.compare);
  setText("count", current ? intFormat.format(current.count) : "—");
  const latestForDistrict = !current && dates.find((date) => lookup(date));
  setText("count-note", current ? sourceFor(current).label
    : latestForDistrict ? "本期暂无记录 · 最近 " + formatPeriod(latestForDistrict) : "本期暂无记录");
  displayChange("change", change(current?.count, prev?.count));
  displayChange("year", change(current?.count, annual?.count));
  const comparisonNote = (row) => row ? formatPeriod(row.date) + " · " + intFormat.format(row.count) + " 套" : "对比期暂无数据";
  setText("change-note", comparisonNote(prev));
  setText("year-note", comparisonNote(annual));
  const area = current?.area;
  setText("area", area == null ? "—" : areaFormat.format(area >= 10000 ? area / 10000 : area));
  setText("area-unit", area >= 10000 ? "万㎡" : "㎡");
  setText("area-note", area == null ? "本期暂无面积数据" : current.count
    ? "套均 " + areaFormat.format(area / current.count) + " ㎡"
    : "二手住宅成交面积");
}

function renderRegions(rows) {
  const { metric } = state;
  const metricFormat = metric === "count" ? intFormat : areaFormat;
  const unit = metric === "count" ? "套" : "㎡";
  const city = lookup(state.date, wholeCity);
  const districts = rows.filter((row) => row.date === state.date && row.district !== wholeCity && row[metric] != null);
  districts.sort((a, b) => b[metric] - a[metric] || a.district.localeCompare(b.district, "zh-CN"));
  setText("region-period", formatPeriod(state.date) + " · 二手住宅");
  setText("region-coverage", districts.length ? "已收录 " + districts.length + " 区" : "暂无记录");
  const ranking = byId("ranking");
  ranking.replaceChildren();
  if (districts.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "这期暂无分区记录。";
    ranking.append(empty);
    setText("region-note", "");
    return;
  }
  const total = districts.reduce((sum, row) => sum + row[metric], 0);
  const cityValue = city?.[metric];
  const precision = metric === "count" ? .5 : .005 * (districts.length + 1);
  const consistent = cityValue != null && Math.abs(cityValue - total) < precision;
  const showShare = cityValue > 0 && (total < cityValue || consistent);
  const max = districts[0][metric] || 1;
  for (const row of districts) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rank-row";
    button.dataset.district = row.district;
    button.setAttribute("aria-pressed", String(row.district === state.district));
    const value = row[metric];
    const share = showShare ? " · " + (value / cityValue * 100).toFixed(1) + "%" : "";
    button.setAttribute("aria-label", row.district + "成交" + metricFormat.format(value) + unit + share + "，查看该区");
    const label = document.createElement("span");
    label.textContent = row.district;
    const track = document.createElement("span");
    track.className = "rank-track";
    const bar = document.createElement("i");
    bar.style.width = (value / max * 100) + "%";
    track.append(bar);
    const count = document.createElement("strong");
    count.textContent = metricFormat.format(value) + share;
    button.append(label, track, count);
    ranking.append(button);
  }
  const totalText = "已收录区合计 " + metricFormat.format(total) + " " + unit;
  const coverage = consistent ? " · 与全市总量相符"
    : cityValue == null ? " · 全市总量缺失"
    : cityValue > total ? " · 部分区域暂无数据" : " · 分区合计与全市值有差异";
  setText("region-note", totalText + coverage + (showShare ? " · 百分比为全市占比" : ""));
}

function renderTable() {
  const body = byId("table-body");
  body.replaceChildren();
  const totalPages = Math.max(1, Math.ceil(visibleDetails.length / pageSize));
  state.page = Math.min(state.page, totalPages - 1);
  const first = state.page * pageSize;
  const pageRows = visibleDetails.slice(first, first + pageSize);
  for (const row of pageRows) {
    const tr = document.createElement("tr");
    tr.insertCell().textContent = formatPeriod(row.date);
    tr.insertCell().textContent = row.district === wholeCity ? "深圳全市" : row.district;
    const count = tr.insertCell();
    count.className = "numeric";
    count.textContent = intFormat.format(row.count);
    const area = tr.insertCell();
    area.className = "numeric";
    area.textContent = row.area == null ? "—" : areaFormat.format(row.area);
    const mean = tr.insertCell();
    mean.className = "numeric";
    mean.textContent = row.area != null && row.count ? areaFormat.format(row.area / row.count) : "—";
    const { label, url } = sourceFor(row);
    const attribution = document.createElement(url ? "a" : "span");
    if (url) {
      attribution.href = url;
      attribution.target = "_blank";
      attribution.rel = "noopener noreferrer";
    } else {
      attribution.className = "muted";
    }
    attribution.textContent = label;
    tr.insertCell().append(attribution);
    body.append(tr);
  }
  if (!pageRows.length) {
    const row = body.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 6;
    cell.className = "empty";
    cell.textContent = "当前筛选暂无成交明细。";
  }
  setText("page-count", pageRows.length
    ? (first + 1) + "–" + (first + pageRows.length) + " 条 / 共 " + visibleDetails.length + " 条"
    : "共 0 条");
  byId("page-prev").disabled = state.page === 0;
  byId("page-next").disabled = state.page >= totalPages - 1;
  byId("export").disabled = visibleDetails.length === 0;
}

function visiblePeriods(latest, range) {
  if (!latest) return [];
  const periodStep = state.kind === "weekly" ? 7 : 1;
  const first = shift(latest, periodStep * (1 - range));
  const end = state.date < first ? state.date : latest;
  return Array.from({ length: range }, (_, index) => shift(end, periodStep * (index + 1 - range)));
}

function render() {
  const rows = availableRows();
  const config = granularity[state.kind];
  const dates = [...new Set(rows.map((row) => row.date))].sort().reverse();
  const latest = dates[0] ?? "";
  const districts = [...new Set(rows.map((row) => row.district))].filter((name) => name !== wholeCity);
  districts.sort((a, b) => a.localeCompare(b, "zh-CN"));
  if (!dates.includes(state.date)) state.date = latest;
  if (state.district !== wholeCity && !districts.includes(state.district)) state.district = wholeCity;
  selectOptions(byId("district-select"), [[wholeCity, "深圳全市"], ...districts.map((district) => [district, district])], state.district);
  selectOptions(byId("date-select"), dates.map((date) => [date, formatPeriod(date)]), state.date);
  setText("date-label", config.label);
  setText("table-date", config.label);
  setText("data-status", latest ? "已收录至 " + formatDate(state.kind === "weekly" ? shift(latest, 6) : latest) : "暂无完整统计期");
  byId("backup").hidden = importedRows.length === 0;
  document.querySelectorAll("[data-kind]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.kind === state.kind));
  });
  document.querySelectorAll("[data-metric]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.metric === state.metric));
  });
  const range = state.ranges[state.kind];
  byId("range-buttons").replaceChildren(...config.options.map((choice) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.range = choice;
    button.textContent = choice + config.unit;
    button.setAttribute("aria-pressed", String(choice === range));
    return button;
  }));
  const periods = visiblePeriods(latest, range);
  chartPoints = periods.map((date) => ({ date, value: lookup(date)?.[state.metric] ?? null }));
  const covered = chartPoints.filter((point) => point.value !== null).length;
  setText("coverage", periods.length ? covered + " / " + periods.length + " 个统计期有数据" : "需导入完整日数据后汇总");
  const name = state.district === wholeCity ? "深圳全市" : state.district;
  setText("trend-note", name + " · " + config.name + "成交");
  setText("chart-legend", state.metric === "count" ? "二手住宅成交套数" : "二手住宅成交面积（㎡）");
  const endDate = state.kind === "weekly" && periods.length ? shift(periods.at(-1), 6) : periods.at(-1);
  setText("detail-note", name + (periods.length ? " · " + formatDate(periods[0]) + " 至 " + formatDate(endDate) : ""));
  visibleDetails = periods.slice().reverse().map((date) => lookup(date)).filter(Boolean);
  renderSummary(dates);
  renderRegions(rows);
  renderTable();
  hideChartTip();
  drawChart();
}

function drawChart() {
  const canvas = byId("trend-chart");
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  const ratio = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  const values = chartPoints.filter((point) => point.value !== null);
  byId("chart-empty").hidden = values.length > 0;
  chartRegions = [];
  if (!values.length) return;

  const peak = Math.max(1, ...values.map((point) => point.value));
  const scale = 10 ** Math.floor(Math.log10(peak / 4));
  const step = Math.max(1, [1, 2, 2.5, 5, 10].find((factor) => factor * scale >= peak / 4) * scale);
  const chartMax = step * 4;
  ctx.font = "11px Inter, Microsoft YaHei, sans-serif";
  const left = ctx.measureText(intFormat.format(chartMax)).width + 15;
  const top = 17;
  const bottom = height - 27;
  const right = width - 9;
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  for (let level = 0; level <= 4; level++) {
    const y = bottom - (bottom - top) * level / 4;
    ctx.strokeStyle = "#e8ecf4";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = "#68758c";
    ctx.fillText(intFormat.format(step * level), left - 8, y);
  }

  const interval = (right - left) / chartPoints.length;
  const barWidth = Math.max(4, Math.min(34, interval * .57));
  const labelEvery = Math.max(1, Math.ceil(39 / interval));
  ctx.textAlign = "center";
  for (const [index, point] of chartPoints.entries()) {
    const x = left + interval * (index + .5);
    const selected = point.date === state.date;
    if (point.value !== null) {
      const barHeight = Math.max(2, (bottom - top) * point.value / chartMax);
      const y = bottom - barHeight;
      ctx.fillStyle = selected ? "#344dd5" : "#9daaf4";
      ctx.beginPath();
      ctx.roundRect(x - barWidth / 2, y, barWidth, barHeight, [Math.min(4, barHeight / 2), Math.min(4, barHeight / 2), 0, 0]);
      ctx.fill();
      chartRegions.push({ ...point, x, y, width: interval, top, bottom });
    }
    if ((chartPoints.length - 1 - index) % labelEvery === 0) {
      ctx.fillStyle = selected ? "#263cb6" : "#68758c";
      const [, month, day] = point.date.split("-");
      ctx.fillText(day ? Number(month) + "/" + Number(day) : Number(month) + "月", x, bottom + 15);
    }
  }
}

function hitChart(event) {
  const rect = byId("trend-chart").getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  return chartRegions.find((point) => Math.abs(point.x - x) < point.width / 2 && y >= point.top && y <= point.bottom);
}

function hideChartTip() {
  byId("chart-tip").hidden = true;
  byId("trend-chart").style.cursor = "";
}

function showChartTip(event) {
  const point = hitChart(event);
  if (!point) {
    hideChartTip();
    return;
  }
  const tooltip = byId("chart-tip");
  tooltip.textContent = formatPeriod(point.date) + " · " + (state.metric === "count"
    ? intFormat.format(point.value) + " 套"
    : areaFormat.format(point.value) + " ㎡");
  tooltip.hidden = false;
  const maxX = byId("chart-wrap").clientWidth - tooltip.offsetWidth;
  tooltip.style.left = Math.max(0, Math.min(maxX, point.x - tooltip.offsetWidth / 2)) + "px";
  tooltip.style.top = Math.max(0, point.y - tooltip.offsetHeight - 7) + "px";
  byId("trend-chart").style.cursor = "pointer";
}

function csvField(value) {
  const text = String(value ?? "");
  return /[,"\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

function downloadCsv(filename, rows) {
  const content = rows.map((row) => row.map(csvField).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", content, "\r\n"], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function renderSources() {
  const container = byId("source-list");
  container.replaceChildren();
  for (const source of Object.values(sources)) {
    const card = document.createElement("div");
    card.className = "source-card";
    const title = document.createElement(source.url ? "a" : "strong");
    if (source.url) {
      title.href = source.url;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
    }
    title.textContent = source.title ?? source.label;
    card.append(title);
    if (source.detail) {
      const detail = document.createElement("span");
      detail.className = "muted";
      detail.textContent = source.detail;
      card.append(detail);
    }
    container.append(card);
  }
}

function notify(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
}

async function importFile(file) {
  if (!file || byId("import-file").disabled) return;
  const input = byId("import-file");
  const status = byId("import-status");
  input.disabled = true;
  status.textContent = "正在读取数据…";
  status.classList.remove("error");
  try {
    if (!/\.(csv|json)$/i.test(file.name)) throw new Error("请选择 CSV 或 JSON 文件。");
    if (file.size > 35 * 1024 * 1024) throw new Error("请将文件拆分至 35 MB 以内再导入。");
    const bytes = await file.arrayBuffer();
    let content;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      content = new TextDecoder("gb18030").decode(bytes);
    }
    const { rows, skipped } = window.parseHousingFile(content, file.name);
    const updated = new Map(importedRows.map((row) => [rowKey(row), row]));
    rows.forEach((row) => updated.set(rowKey(row), { ...row, source: "official-import" }));
    const nextRows = [...updated.values()];
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextRows));
    } catch {
      throw new Error("浏览器无法保存这些数据。请检查存储权限，或缩小导入范围。");
    }
    importedRows = nextRows;
    rebuild();
    const newest = rows.reduce((latest, row) => row.date > latest.date ? row : latest, rows[0]);
    state.kind = "daily";
    state.date = newest.date;
    state.district = lookup(newest.date, wholeCity) ? wholeCity : newest.district;
    state.page = 0;
    render();
    status.textContent = "已保存 " + intFormat.format(rows.length) + " 条记录" + (skipped ? "，跳过 " + intFormat.format(skipped) + " 条非住宅、重复或无效记录" : "") + "。";
    notify("成交数据已更新");
  } catch (error) {
    status.textContent = error.message || "读取数据失败，请检查文件。";
    status.classList.add("error");
  } finally {
    input.value = "";
    input.disabled = false;
  }
}

document.querySelectorAll("[data-kind]").forEach((button) => button.addEventListener("click", () => {
  if (state.kind === button.dataset.kind) return;
  state.kind = button.dataset.kind;
  state.date = "";
  state.page = 0;
  render();
}));
byId("district-select").addEventListener("change", (event) => {
  state.district = event.target.value;
  state.page = 0;
  render();
});
byId("date-select").addEventListener("change", (event) => {
  state.date = event.target.value;
  state.page = 0;
  render();
});
byId("range-buttons").addEventListener("click", (event) => {
  const { range } = event.target.dataset;
  if (!range) return;
  state.ranges[state.kind] = Number(range);
  state.page = 0;
  render();
  byId("range-buttons").querySelector('[aria-pressed="true"]').focus();
});
byId("metric-buttons").addEventListener("click", (event) => {
  const { metric } = event.target.dataset;
  if (!metric || metric === state.metric) return;
  state.metric = metric;
  render();
});
byId("ranking").addEventListener("click", (event) => {
  const button = event.target.closest("[data-district]");
  if (!button) return;
  const district = button.dataset.district;
  state.district = state.district === district ? wholeCity : district;
  state.page = 0;
  render();
  [...byId("ranking").children].find((element) => element.dataset.district === district)?.focus();
});
byId("trend-chart").addEventListener("pointermove", showChartTip);
byId("trend-chart").addEventListener("pointerleave", hideChartTip);
byId("trend-chart").addEventListener("click", (event) => {
  const point = hitChart(event);
  if (!point) return;
  state.date = point.date;
  state.page = 0;
  render();
});
new ResizeObserver(() => {
  hideChartTip();
  drawChart();
}).observe(byId("chart-wrap"));
byId("page-prev").addEventListener("click", () => { state.page--; renderTable(); });
byId("page-next").addEventListener("click", () => { state.page++; renderTable(); });
byId("export").addEventListener("click", () => {
  downloadCsv("深圳二手住宅-" + state.district + "-" + state.date + ".csv", [
    ["统计周期", "统计期", "区域", "成交套数", "成交面积", "套均面积", "来源", "来源链接"],
    ...visibleDetails.map((row) => [
      granularity[row.kind].name, row.kind === "weekly" ? row.date + " 至 " + shift(row.date, 6) : row.date,
      row.district, row.count, row.area,
      row.area != null && row.count ? (row.area / row.count).toFixed(2) : "",
      sourceFor(row).label, sourceFor(row).url
    ])
  ]);
  notify("已导出当前筛选明细");
});
byId("backup").addEventListener("click", () => {
  downloadCsv("深圳二手住宅-导入数据备份.csv", [
    ["TJ_DATE", "ZONE", "HOUSE_USAGE2", "CJ_NUM", "CJ_AREA"],
    ...importedRows.map((row) => [row.date, row.district, "住宅", row.count, row.area])
  ]);
});
document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => {
  byId(button.dataset.open + "-dialog").showModal();
}));
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.querySelector(".close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});
document.querySelectorAll("nav a").forEach((link) => link.addEventListener("click", () => {
  document.querySelector("nav [aria-current]")?.removeAttribute("aria-current");
  link.setAttribute("aria-current", "location");
}));
byId("import-file").addEventListener("change", (event) => importFile(event.target.files[0]));
const dropzone = byId("dropzone");
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropzone.classList.add("dragging");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropzone.classList.remove("dragging");
  importFile(event.dataTransfer.files[0]);
});

rebuild();
renderSources();
render();
