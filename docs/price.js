(() => {
  const panel = document.getElementById('prices');
  if (!panel) return;

  const rows = [...(window.NBS_PRICE_ROWS || [])].sort((a, b) => a.date.localeCompare(b.date));
  const series = [
    { key: 'overall', label: '全市总体', color: '#344dd5', dash: '' },
    { key: 'upTo90', label: '90㎡及以下', color: '#167b65', dash: '7 4' },
    { key: 'from90To144', label: '90–144㎡', color: '#a86119', dash: '3 3' },
    { key: 'above144', label: '144㎡以上', color: '#963f75', dash: '11 4 2 4' },
  ];
  const statsTitle = '国家统计局 70 城月报';
  const dateLabel = date => `${date.slice(0, 4)}年${Number(date.slice(5))}月`;
  const percent = value => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
  const rate = (row, key, metric) => Math.round((row[key][metric] - 100) * 10) / 10;
  const svg = (name, attrs = {}, content) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
    if (content !== undefined) element.textContent = content;
    return element;
  };

  panel.innerHTML = `
    <div class="panel-head price-head">
      <div>
        <h2>二手住宅销售价格指数</h2>
        <p>国家统计局 · 深圳全市及三个建筑面积段</p>
      </div>
      <div class="price-tabs" role="group" aria-label="价格指数比较方式">
        <button type="button" data-price-metric="0" aria-pressed="true">环比</button>
        <button type="button" data-price-metric="1" aria-pressed="false">同比</button>
      </div>
    </div>
    <div class="price-body">
      <div class="price-controls">
        <label>时间范围
          <select data-price-range aria-label="价格指数时间范围">
            <option value="6">近6个月</option>
            <option value="12" selected>近12个月</option>
            <option value="0">全部</option>
          </select>
        </label>
        <label>查看月份 <select data-price-month aria-label="查看价格指数月份"></select></label>
      </div>
      <div class="price-values" aria-live="polite"></div>
      <div class="price-chart-scroll"><svg class="price-plot" role="img"></svg></div>
      <p class="price-source"><a data-price-source target="_blank" rel="noopener"></a></p>
      <details class="price-details">
        <summary>查看价格指数明细</summary>
        <div class="price-table-wrap">
          <table>
            <thead><tr><th scope="col">月份</th>${series.map(item => `<th scope="col">${item.label}</th>`).join('')}<th scope="col">来源</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </details>
      <p class="price-note">涨跌幅由公布指数减 100 得出。面积段按国家统计局分类，其中 90–144㎡为大于 90㎡、不超过 144㎡。</p>
    </div>`;
  if (!rows.length) {
    panel.querySelector('.price-tabs').hidden = true;
    panel.querySelector('.price-body').textContent = '暂无可显示的价格指数。';
    return;
  }

  const tabs = [...panel.querySelectorAll('[data-price-metric]')];
  const range = panel.querySelector('[data-price-range]');
  const months = panel.querySelector('[data-price-month]');
  const values = panel.querySelector('.price-values');
  const plot = panel.querySelector('.price-plot');
  const plotFrame = panel.querySelector('.price-chart-scroll');
  const source = panel.querySelector('[data-price-source]');
  const table = panel.querySelector('tbody');
  let metric = 0;
  let chartWidth = 900;

  function displayRows() {
    const length = Number(range.value);
    return length ? rows.slice(-length) : rows;
  }

  function drawChart(visible, selected) {
    const size = { width: chartWidth, height: 250, top: 13, right: 22, bottom: 34, left: 50 };
    const { width, height, top, right, bottom, left } = size;
    const points = visible.flatMap(row => series.map(item => rate(row, item.key, metric)));
    const minimum = Math.min(0, ...points);
    const maximum = Math.max(0, ...points);
    const step = (maximum - minimum) > 4 ? 2 : (maximum - minimum) > 2 ? 1 : .5;
    const low = Math.floor(minimum / step) * step;
    const high = Math.max(low + step, Math.ceil(maximum / step) * step);
    const x = i => visible.length === 1 ? width / 2 : left + i * (width - left - right) / (visible.length - 1);
    const y = value => top + (high - value) * (height - top - bottom) / (high - low);
    const selectedIndex = visible.indexOf(selected);

    plot.replaceChildren();
    plot.setAttribute('viewBox', `0 0 ${width} ${height}`);
    plot.setAttribute('aria-label', `深圳二手住宅价格${metric ? '同比' : '环比'}，${dateLabel(visible[0].date)}至${dateLabel(visible.at(-1).date)}`);
    for (let tick = low; tick <= high; tick += step) {
      plot.append(
        svg('line', { x1: left, x2: width - right, y1: y(tick), y2: y(tick), class: tick === 0 ? 'price-zero' : 'price-grid' }),
        svg('text', { x: left - 9, y: y(tick) + 4, 'text-anchor': 'end', class: 'price-axis' }, `${tick}%`),
      );
    }
    const labelStep = Math.ceil(visible.length / (width < 550 ? 4 : 7));
    visible.forEach((row, index) => {
      if (index % labelStep !== 0 && index !== visible.length - 1) return;
      if (index === visible.length - 2 && index % labelStep === 0 && labelStep > 1) return;
      plot.append(svg('text', { x: x(index), y: height - 12, 'text-anchor': 'middle', class: 'price-axis' }, row.date.slice(2)));
    });
    if (selectedIndex >= 0) {
      plot.append(svg('line', { x1: x(selectedIndex), x2: x(selectedIndex), y1: top, y2: height - bottom, class: 'price-marker' }));
    }
    for (const item of [...series].reverse()) {
      const coords = visible.map((row, index) => `${x(index)},${y(rate(row, item.key, metric))}`);
      plot.append(svg('polyline', {
        points: coords.join(' '), fill: 'none', stroke: item.color,
        'stroke-width': item.key === 'overall' ? 3 : 2, 'stroke-dasharray': item.dash,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
      if (selectedIndex >= 0) {
        plot.append(svg('circle', {
          cx: x(selectedIndex), cy: y(rate(selected, item.key, metric)), r: 4,
          fill: item.color, stroke: '#fff', 'stroke-width': 1.25,
        }));
      }
    }
    const targetWidth = visible.length === 1 ? width - left - right : (width - left - right) / (visible.length - 1);
    visible.forEach((row, index) => {
      const hit = svg('rect', { x: Math.max(left, x(index) - targetWidth / 2), y: top, width: Math.min(width - right, x(index) + targetWidth / 2) - Math.max(left, x(index) - targetWidth / 2), height: height - top - bottom, class: 'price-point-target' });
      hit.append(svg('title', {}, dateLabel(row.date)));
      hit.addEventListener('click', () => {
        months.value = row.date;
        render();
      });
      plot.append(hit);
    });
  }

  function render() {
    const visible = displayRows();
    const selected = visible.find(row => row.date === months.value) || visible.at(-1);
    values.innerHTML = series.map(item => `
      <div class="price-value">
        <span class="price-series-label"><i style="--series-color:${item.color}"></i>${item.label}</span>
        <strong>${percent(rate(selected, item.key, metric))}</strong>
      </div>`).join('');
    source.textContent = `${dateLabel(selected.date)}原表 · ${statsTitle}`;
    source.href = selected.url;
    drawChart(visible, selected);

    table.innerHTML = [...visible].reverse().map(row => `
      <tr${row === selected ? ' class="price-selected"' : ''}>
        <th scope="row">${row.date}</th>
        ${series.map(item => `<td title="公布指数 ${row[item.key][metric].toFixed(1)}">${percent(rate(row, item.key, metric))}</td>`).join('')}
        <td><a href="${row.url}" target="_blank" rel="noopener" aria-label="查看${dateLabel(row.date)}国家统计局原表">原表</a></td>
      </tr>`).join('');
  }

  function updateMonthList() {
    const previous = months.value;
    const visible = displayRows();
    months.replaceChildren(...[...visible].reverse().map(row => new Option(dateLabel(row.date), row.date)));
    months.value = visible.some(row => row.date === previous) ? previous : visible.at(-1).date;
    render();
  }

  tabs.forEach(tab => tab.addEventListener('click', () => {
    metric = Number(tab.dataset.priceMetric);
    tabs.forEach(item => item.setAttribute('aria-pressed', String(item === tab)));
    render();
  }));
  range.addEventListener('change', updateMonthList);
  months.addEventListener('change', render);
  chartWidth = Math.min(900, plotFrame.clientWidth || chartWidth);
  updateMonthList();
  new ResizeObserver(() => {
    const width = Math.min(900, plotFrame.clientWidth || chartWidth);
    if (width === chartWidth) return;
    chartWidth = width;
    const visible = displayRows();
    drawChart(visible, visible.find(row => row.date === months.value));
  }).observe(plotFrame);
})();
