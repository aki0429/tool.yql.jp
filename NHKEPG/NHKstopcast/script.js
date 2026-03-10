// NHK 放送休止情報一覧
// 全国の放送局から放送休止情報を取得・表示

const STATIONS = [
  // 北海道 (info記事方式: station_info/ から放送休止記事を検索)
  { slug: 'hokkaido', name: '北海道内の各放送局', region: 'hokkaido', regionName: '北海道', type: 'info' },
  // 東北
  { slug: 'aomori', name: '青森放送局', region: 'tohoku', regionName: '東北' },
  { slug: 'morioka', name: '盛岡放送局', region: 'tohoku', regionName: '東北' },
  { slug: 'sendai', name: '仙台放送局', region: 'tohoku', regionName: '東北' },
  { slug: 'akita', name: '秋田放送局', region: 'tohoku', regionName: '東北' },
  { slug: 'yamagata', name: '山形放送局', region: 'tohoku', regionName: '東北' },
  { slug: 'fukushima', name: '福島放送局', region: 'tohoku', regionName: '東北', type: 'info' },
  // 関東・甲信越
  { slug: 'mito', name: '水戸放送局', region: 'kanto', regionName: '関東・甲信越' },
  { slug: 'utsunomiya', name: '宇都宮放送局', region: 'kanto', regionName: '関東・甲信越' },
  { slug: 'maebashi', name: '前橋放送局', region: 'kanto', regionName: '関東・甲信越' },
  { slug: 'saitama', name: 'さいたま放送局', region: 'kanto', regionName: '関東・甲信越' },
  { slug: 'chiba', name: '千葉放送局', region: 'kanto', regionName: '関東・甲信越' },
  { slug: 'yokohama', name: '横浜放送局', region: 'kanto', regionName: '関東・甲信越' },
  { slug: 'niigata', name: '新潟放送局', region: 'kanto', regionName: '関東・甲信越' },
  { slug: 'kofu', name: '甲府放送局', region: 'kanto', regionName: '関東・甲信越', type: 'kyushi' },
  { slug: 'nagano', name: '長野放送局', region: 'kanto', regionName: '関東・甲信越' },
  { slug: 'shutoken', name: '首都圏放送局', region: 'kanto', regionName: '関東・甲信越' },
  // 東海・北陸
  { slug: 'toyama', name: '富山放送局', region: 'tokai', regionName: '東海・北陸' },
  { slug: 'kanazawa', name: '金沢放送局', region: 'tokai', regionName: '東海・北陸' },
  { slug: 'fukui', name: '福井放送局', region: 'tokai', regionName: '東海・北陸' },
  { slug: 'gifu', name: '岐阜放送局', region: 'tokai', regionName: '東海・北陸' },
  { slug: 'shizuoka', name: '静岡放送局', region: 'tokai', regionName: '東海・北陸' },
  { slug: 'nagoya', name: '名古屋放送局', region: 'tokai', regionName: '東海・北陸' },
  { slug: 'tsu', name: '津放送局', region: 'tokai', regionName: '東海・北陸' },
  // 近畿
  { slug: 'osaka', name: '関西圏域局', region: 'kinki', regionName: '近畿' },
  // 中国
  { slug: 'tottori', name: '鳥取放送局', region: 'chugoku', regionName: '中国' },
  { slug: 'matsue', name: '松江放送局', region: 'chugoku', regionName: '中国', type: 'kyushi' },
  { slug: 'okayama', name: '岡山放送局', region: 'chugoku', regionName: '中国' },
  { slug: 'hiroshima', name: '広島放送局', region: 'chugoku', regionName: '中国', type: 'pdf', pdfUrl: 'https://www.nhk.or.jp/hiroshima/station_info/kyushi_pdf/list.pdf' },
  { slug: 'yamaguchi', name: '山口放送局', region: 'chugoku', regionName: '中国' },
  // 四国
  { slug: 'tokushima', name: '徳島放送局', region: 'shikoku', regionName: '四国' },
  { slug: 'takamatsu', name: '高松放送局', region: 'shikoku', regionName: '四国' },
  { slug: 'matsuyama', name: '松山放送局', region: 'shikoku', regionName: '四国' },
  { slug: 'kochi', name: '高知放送局', region: 'shikoku', regionName: '四国' },
  // 九州・沖縄
  { slug: 'fukuoka', name: '福岡放送局', region: 'kyushu', regionName: '九州・沖縄' },
  { slug: 'saga', name: '佐賀放送局', region: 'kyushu', regionName: '九州・沖縄' },
  { slug: 'nagasaki', name: '長崎放送局', region: 'kyushu', regionName: '九州・沖縄' },
  { slug: 'kumamoto', name: '熊本放送局', region: 'kyushu', regionName: '九州・沖縄' },
  { slug: 'oita', name: '大分放送局', region: 'kyushu', regionName: '九州・沖縄', type: 'kyuushi' },
  { slug: 'miyazaki', name: '宮崎放送局', region: 'kyushu', regionName: '九州・沖縄' },
  { slug: 'kagoshima', name: '鹿児島放送局', region: 'kyushu', regionName: '九州・沖縄' },
  { slug: 'okinawa', name: '沖縄放送局', region: 'kyushu', regionName: '九州・沖縄' },
];

const REGION_ORDER = [
  'hokkaido', 'tohoku', 'kanto', 'tokai', 'kinki', 'chugoku', 'shikoku', 'kyushu'
];

const REGION_NAMES = {
  hokkaido: '北海道',
  tohoku: '東北',
  kanto: '関東・甲信越',
  tokai: '東海・北陸',
  kinki: '近畿',
  chugoku: '中国',
  shikoku: '四国',
  kyushu: '九州・沖縄',
};

// State
let allData = []; // { station, rows, error? }
let fetchedCount = 0;

// DOM
const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const resultsEl = document.getElementById('results');
const regionFilter = document.getElementById('regionFilter');
const channelFilter = document.getElementById('channelFilter');
const todayOnlyCheckbox = document.getElementById('todayOnly');
const reloadBtn = document.getElementById('reloadBtn');

// ──────── Utility ────────

function getTodayStr() {
  const now = new Date();
  return `${now.getMonth() + 1}月${now.getDate()}日`;
}

function isToday(dateStr) {
  const today = getTodayStr();
  return dateStr.includes(today);
}

function getChannelClass(channel) {
  if (/総合/.test(channel)) return 'sogo';
  if (/Eテレ|[EＥ]テレ|教育/.test(channel)) return 'etele';
  if (/ラジオ|R1|R2|第[１1]|第[２2]/.test(channel)) return 'radio';
  if (/FM|ＦＭ/.test(channel)) return 'fm';
  return 'other';
}

function matchesChannelFilter(channel, filter) {
  if (filter === 'all') return true;
  if (filter === '総合') return /総合/.test(channel);
  if (filter === 'Eテレ') return /Eテレ|[EＥ]テレ|教育/.test(channel);
  if (filter === 'ラジオ') return /ラジオ|R1|R2|第[１1]|第[２2]/.test(channel);
  if (filter === 'FM') return /FM|ＦＭ/.test(channel);
  return true;
}

// ──────── Fetch ────────

async function fetchStation(station) {
  try {
    // PDF方式の局はデータ取得せずリンクのみ返す
    if (station.type === 'pdf') {
      return { station, rows: [], pdf: station.pdfUrl };
    }

    let url = `proxy.php?station=${station.slug}`;
    if (station.type) {
      url += `&type=${station.type}`;
    }

    const resp = await fetch(url);
    const data = await resp.json();
    if (data.error) {
      return { station, rows: [], error: data.error };
    }
    return {
      station,
      rows: data.rows || [],
      sourceUrl: data.sourceUrl || null,
    };
  } catch (e) {
    return { station, rows: [], error: e.message };
  }
}

async function fetchAll() {
  allData = [];
  fetchedCount = 0;

  statusEl.className = 'status loading';
  statusEl.innerHTML = `<span class="loading-spinner"></span>取得中... 0 / ${STATIONS.length}`;
  resultsEl.innerHTML = '';
  summaryEl.innerHTML = '';

  // Add progress bar
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';
  progressBar.innerHTML = '<div class="fill" style="width:0%"></div>';
  statusEl.appendChild(progressBar);

  const statusText = document.createElement('span');
  statusText.textContent = `取得中... 0 / ${STATIONS.length}`;
  statusEl.insertBefore(statusText, progressBar);

  // Remove the initial text node
  if (statusEl.firstChild && statusEl.firstChild.nodeType === 3) {
    statusEl.firstChild.textContent = '';
  }

  // Fetch in parallel with concurrency limit
  const CONCURRENCY = 6;
  const queue = [...STATIONS];
  const results = [];

  async function worker() {
    while (queue.length > 0) {
      const station = queue.shift();
      const result = await fetchStation(station);
      results.push(result);
      fetchedCount++;

      const pct = Math.round((fetchedCount / STATIONS.length) * 100);
      progressBar.querySelector('.fill').style.width = pct + '%';
      statusText.textContent = `取得中... ${fetchedCount} / ${STATIONS.length}`;
    }
  }

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  allData = results;
  renderAll();
}

// ──────── Render ────────

function renderAll() {
  const regionFilterVal = regionFilter.value;
  const channelFilterVal = channelFilter.value;
  const todayOnly = todayOnlyCheckbox.checked;

  // Filter
  let filtered = allData.filter(d => {
    if (regionFilterVal !== 'all' && d.station.region !== regionFilterVal) return false;
    return true;
  });

  // Count stats
  let totalRows = 0;
  let todayRows = 0;
  let errorCount = 0;
  let stationsWithData = 0;

  filtered.forEach(d => {
    if (d.error) { errorCount++; return; }
    let rows = d.rows;
    if (channelFilterVal !== 'all') {
      rows = rows.filter(r => matchesChannelFilter(r.channel, channelFilterVal));
    }
    if (rows.length > 0) stationsWithData++;
    rows.forEach(r => {
      totalRows++;
      if (isToday(r.date)) todayRows++;
    });
  });

  // Summary
  summaryEl.innerHTML = `
    <div class="summary-card">
      <div class="label">取得局数</div>
      <div class="value">${filtered.length - errorCount} / ${filtered.length}</div>
    </div>
    <div class="summary-card">
      <div class="label">休止情報件数</div>
      <div class="value">${totalRows}</div>
    </div>
    <div class="summary-card today">
      <div class="label">今日の休止</div>
      <div class="value">${todayRows}</div>
    </div>
    ${errorCount > 0 ? `
    <div class="summary-card error-count">
      <div class="label">取得エラー</div>
      <div class="value">${errorCount}</div>
    </div>` : ''}
  `;

  // Status
  statusEl.className = 'status done';
  statusEl.textContent = `✓ ${filtered.length - errorCount}局から取得完了 (${new Date().toLocaleTimeString('ja-JP')})`;

  // Group by region
  resultsEl.innerHTML = '';

  const regionGroups = {};
  filtered.forEach(d => {
    const region = d.station.region;
    if (!regionGroups[region]) regionGroups[region] = [];
    regionGroups[region].push(d);
  });

  for (const region of REGION_ORDER) {
    if (!regionGroups[region]) continue;
    const stations = regionGroups[region];

    // Region header
    const regionHeader = document.createElement('div');
    regionHeader.className = 'region-group-header';
    regionHeader.textContent = REGION_NAMES[region];
    resultsEl.appendChild(regionHeader);

    for (const data of stations) {
      const section = createStationSection(data, channelFilterVal, todayOnly);
      resultsEl.appendChild(section);
    }
  }
}

function createStationSection(data, channelFilterVal, todayOnly) {
  const section = document.createElement('div');
  section.className = 'station-section';

  const { station, rows, error } = data;

  // Filter rows
  let displayRows = rows;
  if (channelFilterVal !== 'all') {
    displayRows = displayRows.filter(r => matchesChannelFilter(r.channel, channelFilterVal));
  }
  if (todayOnly) {
    displayRows = displayRows.filter(r => isToday(r.date));
  }

  // Collapse if no data or error
  const hasData = displayRows.length > 0;
  if (!hasData) section.classList.add('collapsed');

  // Header
  const header = document.createElement('div');
  header.className = 'station-header';
  header.innerHTML = `
    <div>
      <span class="station-name">${station.name}</span>
      <span class="region-tag">${station.regionName}</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;">
      <span class="count-badge">${error ? '⚠ エラー' : data.pdf ? '📄 PDF' : `${displayRows.length}件`}</span>
      <span class="toggle-icon">▶</span>
    </div>
  `;
  header.addEventListener('click', () => {
    section.classList.toggle('collapsed');
  });
  section.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'station-body';

  if (error) {
    body.innerHTML = `<div class="station-error">取得できませんでした (${error === 'fetch_failed' ? 'ページが存在しない可能性があります' : error === 'article_not_found' ? '放送休止記事が見つかりませんでした' : error})</div>`;
  } else if (data.pdf) {
    body.innerHTML = `<div class="station-empty" style="padding:12px 16px;">
      <span>📄 この局はPDFで情報を公開しています</span><br>
      <a href="${escapeHtml(data.pdf)}" target="_blank" rel="noopener" style="color:#4fc3f7;text-decoration:underline;font-size:0.9rem;">放送休止情報PDF を開く ↗</a>
    </div>`;
  } else if (displayRows.length === 0) {
    body.innerHTML = `<div class="station-empty">${todayOnly ? '今日の放送休止はありません' : '現在、放送休止の予定はありません'}</div>`;
  } else {
    const table = document.createElement('table');
    table.className = 'rest-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>対象地域</th>
          <th>日付</th>
          <th>時間</th>
          <th>放送波</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement('tbody');
    for (const row of displayRows) {
      const tr = document.createElement('tr');
      if (isToday(row.date)) tr.classList.add('today-row');

      const chClass = getChannelClass(row.channel);
      tr.innerHTML = `
        <td>${escapeHtml(row.area)}</td>
        <td>${escapeHtml(row.date)}</td>
        <td>${escapeHtml(row.time)}</td>
        <td><span class="channel-badge ${chClass}">${escapeHtml(row.channel)}</span></td>
      `;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    body.appendChild(table);
  }

  section.appendChild(body);
  return section;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ──────── Events ────────

regionFilter.addEventListener('change', renderAll);
channelFilter.addEventListener('change', renderAll);
todayOnlyCheckbox.addEventListener('change', renderAll);
reloadBtn.addEventListener('click', fetchAll);

// ──────── Init ────────
fetchAll();
