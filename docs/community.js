(() => {
  "use strict";

  const get = (id) => document.getElementById("community-" + id);
  const clean = (text) => text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  const number = new Intl.NumberFormat("zh-CN");
  const rows = (window.COMMUNITY_REFERENCE_ROWS ?? []).map(([district, street, name, price]) => ({
    district, street, name, price, keyword: clean(name)
  }));
  const size = 8;
  let page = 0;

  function options(select, items, defaultLabel) {
    select.replaceChildren(new Option(defaultLabel, ""), ...items.map((value) => new Option(value, value)));
  }

  function streets() {
    const district = get("district").value;
    const names = rows.filter((row) => !district || row.district === district).map((row) => row.street);
    options(get("street"), [...new Set(names)], "全部街道");
  }

  function render() {
    const query = clean(get("search").value);
    const district = get("district").value;
    const street = get("street").value;
    const matched = rows.filter((row) =>
      (!district || row.district === district) && (!street || row.street === street) && row.keyword.includes(query));
    const first = page * size;
    const tbody = get("results");
    tbody.replaceChildren();
    for (const row of matched.slice(first, first + size)) {
      const tr = tbody.insertRow();
      const link = document.createElement("button");
      link.className = "community-sale-link";
      link.type = "button";
      link.textContent = row.name;
      link.title = "查询该小区成交样本";
      link.addEventListener("click", () => document.dispatchEvent(new CustomEvent("lookup-community-sales", { detail: row.name })));
      tr.insertCell().append(link);
      tr.insertCell().textContent = row.district;
      tr.insertCell().textContent = row.street;
      const price = tr.insertCell();
      price.className = "numeric";
      price.textContent = number.format(row.price);
    }
    if (matched.length === 0) {
      const cell = tbody.insertRow().insertCell();
      cell.colSpan = 4;
      cell.className = "empty";
      cell.textContent = "历史参考价表中没有匹配的小区。";
    }
    get("count").textContent = matched.length
      ? (first + 1) + "–" + Math.min(first + size, matched.length) + " 条 / 共 " + number.format(matched.length) + " 条"
      : "共 0 条";
    get("prev").disabled = page === 0;
    get("next").disabled = first + size >= matched.length;
  }

  function reset() {
    page = 0;
    render();
  }

  options(get("district"), [...new Set(rows.map((row) => row.district))], "全部区域");
  streets();
  get("district").addEventListener("change", () => { streets(); reset(); });
  get("street").addEventListener("change", reset);
  get("search").addEventListener("input", reset);
  get("prev").addEventListener("click", () => { page--; render(); });
  get("next").addEventListener("click", () => { page++; render(); });
  render();
})();
