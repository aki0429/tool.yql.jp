const COMPANIES = [
    { id: "hokkaido", name: "北海道", area: "北海道電力ネットワーク", format: "standard" },
    { id: "tohoku", name: "東北", area: "東北電力ネットワーク", format: "tohokuRealtime" },
    { id: "tokyo", name: "東京", area: "東京電力パワーグリッド", format: "standard" },
    { id: "chubu", name: "中部", area: "中部電力パワーグリッド", format: "standard" },
    { id: "hokuriku", name: "北陸", area: "北陸電力送配電", format: "standard" },
    { id: "kansai", name: "関西", area: "関西電力送配電", format: "standard" },
    { id: "chugoku", name: "中国", area: "中国電力ネットワーク", format: "standard" },
    { id: "shikoku", name: "四国", area: "四国電力送配電", format: "standard" },
    { id: "kyushu", name: "九州", area: "九州電力送配電", format: "standard" },
    { id: "okinawa", name: "沖縄", area: "沖縄電力", format: "standard" },
];

const state = {
    selectedId: "tokyo",
    records: {},
    loading: new Set(COMPANIES.map((company) => company.id)),
};

async function readResponseText(response) {
    const contentType = response.headers.get("content-type") || "";
    const charsetMatch = contentType.match(/charset=([^;]+)/i);
    const candidateEncodings = [];

    if (charsetMatch) {
        candidateEncodings.push(charsetMatch[1].trim().replace(/["']/g, ""));
    }

    candidateEncodings.push("utf-8", "shift_jis", "windows-31j", "cp932");

    const buffer = await response.arrayBuffer();
    const decodedCandidates = [];

    for (const encoding of candidateEncodings) {
        try {
            const text = new TextDecoder(encoding).decode(buffer);
            const replacementCount = (text.match(/\uFFFD/g) || []).length;
            decodedCandidates.push({ text, replacementCount });
        } catch {
            // Try the next encoding.
        }
    }

    if (decodedCandidates.length) {
        decodedCandidates.sort((left, right) => left.replacementCount - right.replacementCount);
        return decodedCandidates[0].text;
    }

    return new TextDecoder().decode(buffer);
}

function parseCsvLine(line) {
    const values = [];
    let value = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const nextChar = line[i + 1];

        if (char === '"' && inQuotes && nextChar === '"') {
            value += '"';
            i += 1;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === "," && !inQuotes) {
            values.push(value);
            value = "";
        } else {
            value += char;
        }
    }

    values.push(value);
    return values;
}

function parseCsvRows(text) {
    return text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((line) => parseCsvLine(line));
}

function parseNumber(value) {
    if (value == null) {
        return null;
    }

    const normalized = String(value).replace(/,/g, "").trim();
    if (!normalized) {
        return null;
    }

    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
}

function isDataRow(row) {
    return row.length >= 3 && /^\d{4}\/\d{1,2}\/\d{1,2}$/.test((row[0] || "").trim());
}

function findHourlyRows(rows) {
    const headerIndex = rows.findIndex((row) => (row[0] || "").trim() === "DATE" && (row[1] || "").trim() === "TIME");
    if (headerIndex === -1) {
        return [];
    }

    return rows.slice(headerIndex + 1).filter(isDataRow);
}

function formatNumber(value) {
    return value == null
        ? "--"
        : value.toLocaleString("ja-JP", { maximumFractionDigits: 1 });
}

function formatPercent(value) {
    return value == null ? "--" : `${value}%`;
}

function computeStatus(record) {
    if (record.reserveRate != null) {
        if (record.reserveRate <= 5) {
            return { label: "Tight", tone: "danger" };
        }
        if (record.reserveRate <= 10) {
            return { label: "Watch", tone: "warn" };
        }
        return { label: "Stable", tone: "good" };
    }

    if (record.usageRate != null) {
        if (record.usageRate >= 95) {
            return { label: "Tight", tone: "danger" };
        }
        if (record.usageRate >= 85) {
            return { label: "Watch", tone: "warn" };
        }
    }

    return { label: "Live", tone: "good" };
}

function parseStandardCsv(company, text) {
    const rows = parseCsvRows(text).filter((row) => row.some((value) => value.trim() !== ""));
    const summary = rows[2] || [];
    const hourlyRows = findHourlyRows(rows).map((row) => ({
        date: row[0],
        time: row[1],
        actual: parseNumber(row[2]),
        forecast: parseNumber(row[3]),
        usageRate: parseNumber(row[4]),
        capacity: parseNumber(row[5]),
    }));

    const latestActual = [...hourlyRows].reverse().find((row) => row.actual != null && row.actual > 0) || hourlyRows[0] || null;

    return {
        company,
        raw: text,
        updateLine: rows[0]?.[0] || "",
        updatedAt: [summary[2], summary[3]].filter(Boolean).join(" "),
        peakSupplyKw: parseNumber(summary[0]),
        peakTime: summary[1] || "--",
        reserveRate: parseNumber(summary[4]),
        usageRate: parseNumber(summary[5]),
        currentDemandKw: latestActual?.actual ?? null,
        currentTime: latestActual ? `${latestActual.date} ${latestActual.time}` : "--",
        hourlyRows,
        status: computeStatus({
            reserveRate: parseNumber(summary[4]),
            usageRate: parseNumber(summary[5]),
        }),
    };
}

function parseTohokuRealtime(company, text) {
    const rows = parseCsvRows(text).filter((row) => row.some((value) => value.trim() !== ""));
    const dataRows = rows.slice(2).filter(isDataRow).map((row) => {
        const actualMw = parseNumber(row[2]);

        return {
            date: row[0],
            time: row[1],
            actual: actualMw == null ? null : actualMw / 10,
            forecast: null,
            usageRate: null,
            capacity: null,
        };
    });

    const latestActual = [...dataRows].reverse().find((row) => row.actual != null) || dataRows[0] || null;
    const peakRow = dataRows.reduce((best, row) => {
        if (!best || (row.actual != null && row.actual > best.actual)) {
            return row;
        }
        return best;
    }, null);

    return {
        company,
        raw: text,
        updateLine: rows[0]?.[0] || "",
        updatedAt: rows[0]?.[0] || "",
        peakSupplyKw: peakRow?.actual ?? null,
        peakTime: peakRow ? `${peakRow.date} ${peakRow.time}` : "--",
        reserveRate: null,
        usageRate: null,
        currentDemandKw: latestActual?.actual ?? null,
        currentTime: latestActual ? `${latestActual.date} ${latestActual.time}` : "--",
        hourlyRows: dataRows,
        status: computeStatus({ reserveRate: null, usageRate: null }),
    };
}

function parseRecord(company, text) {
    if (company.format === "tohokuRealtime") {
        return parseTohokuRealtime(company, text);
    }

    return parseStandardCsv(company, text);
}

function getLoadedRecords() {
    return COMPANIES.map((company) => state.records[company.id]).filter(Boolean);
}

function createSparkline(rows) {
    const width = 720;
    const height = 220;
    const values = rows.map((row) => row.actual).filter((value) => value != null);

    if (!values.length) {
        return '<div class="empty">グラフ化できる時系列データがありません。</div>';
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, 1);
    const points = rows
        .map((row, index) => {
            if (row.actual == null) {
                return null;
            }
            const x = (index / Math.max(rows.length - 1, 1)) * width;
            const y = height - ((row.actual - min) / range) * (height - 24) - 12;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .filter(Boolean)
        .join(" ");

    return `
        <svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
            <defs>
                <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stop-color="rgba(12,124,89,0.35)"></stop>
                    <stop offset="100%" stop-color="rgba(12,124,89,0.02)"></stop>
                </linearGradient>
            </defs>
            <g stroke="#d8e2dd" stroke-width="1">
                <line x1="0" y1="20" x2="${width}" y2="20"></line>
                <line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}"></line>
                <line x1="0" y1="${height - 20}" x2="${width}" y2="${height - 20}"></line>
            </g>
            <polyline fill="none" stroke="#0c7c59" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" points="${points}"></polyline>
        </svg>
    `;
}

function renderHeroMeta() {
    const records = getLoadedRecords();
    const meta = document.getElementById("hero-meta");
    const updated = records
        .map((record) => record.updatedAt || record.updateLine)
        .filter(Boolean)
        .slice(0, 3);

    meta.innerHTML = [
        `<div class="hero-chip">対応事業者 ${COMPANIES.length} 社</div>`,
        `<div class="hero-chip">取得済み ${records.length} 社</div>`,
        ...updated.map((value) => `<div class="hero-chip">${value}</div>`),
    ].join("");
}

function renderOverview() {
    const records = getLoadedRecords();
    const overview = document.getElementById("overview");

    if (!records.length) {
        overview.innerHTML = '<div class="empty">データを読み込み中です。</div>';
        return;
    }

    const loaded = records.length;
    const currentSum = records.reduce((sum, record) => sum + (record.currentDemandKw || 0), 0);
    const highestUsage = records
        .filter((record) => record.usageRate != null)
        .sort((left, right) => right.usageRate - left.usageRate)[0];
    const lowestReserve = records
        .filter((record) => record.reserveRate != null)
        .sort((left, right) => left.reserveRate - right.reserveRate)[0];

    overview.innerHTML = `
        <article class="overview-item">
            <div class="overview-label">Loaded</div>
            <div class="overview-value">${loaded}</div>
            <div class="overview-note">公開CSV取得に成功した会社数</div>
        </article>
        <article class="overview-item">
            <div class="overview-label">Current Demand</div>
            <div class="overview-value">${formatNumber(currentSum)}</div>
            <div class="overview-note">取得済み会社の現在需要合計</div>
        </article>
        <article class="overview-item">
            <div class="overview-label">Highest Usage</div>
            <div class="overview-value">${highestUsage ? formatPercent(highestUsage.usageRate) : "--"}</div>
            <div class="overview-note">${highestUsage ? highestUsage.company.area : "使用率データなし"}</div>
        </article>
        <article class="overview-item">
            <div class="overview-label">Lowest Reserve</div>
            <div class="overview-value">${lowestReserve ? formatPercent(lowestReserve.reserveRate) : "--"}</div>
            <div class="overview-note">${lowestReserve ? lowestReserve.company.area : "予備率データなし"}</div>
        </article>
    `;
}

function renderCompanyGrid() {
    const grid = document.getElementById("company-grid");

    grid.innerHTML = COMPANIES.map((company) => {
        const record = state.records[company.id];
        const selected = company.id === state.selectedId;

        if (!record) {
            const loading = state.loading.has(company.id) ? "読み込み中" : "取得失敗";
            return `
                <button class="company-card ${selected ? "is-selected" : ""}" data-company-id="${company.id}">
                    <div class="status-pill ${state.loading.has(company.id) ? "" : "danger"}">${loading}</div>
                    <h3 class="company-name">${company.name}</h3>
                    <div class="company-area">${company.area}</div>
                    <div class="company-demand">-- <small>万kW</small></div>
                    <dl class="company-meta">
                        <div><dt>現在</dt><dd>--</dd></div>
                        <div><dt>ピーク</dt><dd>--</dd></div>
                    </dl>
                </button>
            `;
        }

        return `
            <button class="company-card ${selected ? "is-selected" : ""}" data-company-id="${company.id}">
                <div class="status-pill ${record.status.tone === "warn" ? "warn" : record.status.tone === "danger" ? "danger" : ""}">${record.status.label}</div>
                <h3 class="company-name">${company.name}</h3>
                <div class="company-area">${company.area}</div>
                <div class="company-demand">${formatNumber(record.currentDemandKw)} <small>万kW</small></div>
                <dl class="company-meta">
                    <div><dt>現在時刻</dt><dd>${record.currentTime.split(" ").slice(-1)[0] || "--"}</dd></div>
                    <div><dt>予備率</dt><dd>${formatPercent(record.reserveRate)}</dd></div>
                    <div><dt>ピーク需要</dt><dd>${formatNumber(record.peakSupplyKw)}</dd></div>
                    <div><dt>使用率</dt><dd>${formatPercent(record.usageRate)}</dd></div>
                </dl>
            </button>
        `;
    }).join("");

    grid.querySelectorAll("[data-company-id]").forEach((button) => {
        button.addEventListener("click", () => {
            state.selectedId = button.dataset.companyId;
            render();
        });
    });
}

function renderDetails() {
    const details = document.getElementById("details");
    const record = state.records[state.selectedId];

    if (!record) {
        details.innerHTML = '<div class="panel"><div class="empty">選択した会社のデータを取得できていません。</div></div>';
        return;
    }

    const rows = record.hourlyRows.slice(0, 24);
    const tableRows = rows
        .map((row) => `
            <tr>
                <td>${row.time}</td>
                <td>${formatNumber(row.actual)}</td>
                <td>${formatNumber(row.forecast)}</td>
                <td>${formatPercent(row.usageRate)}</td>
                <td>${formatNumber(row.capacity)}</td>
            </tr>
        `)
        .join("");

    details.innerHTML = `
        <section class="panel">
            <div class="panel-head">
                <div>
                    <h3>${record.company.area}</h3>
                    <div class="panel-sub">${record.updatedAt || record.updateLine || "更新時刻不明"}</div>
                </div>
            </div>
            <div class="metric-grid">
                <article class="metric">
                    <div class="metric-label">現在需要</div>
                    <div class="metric-value">${formatNumber(record.currentDemandKw)} <small>万kW</small></div>
                </article>
                <article class="metric">
                    <div class="metric-label">ピーク需要見通し</div>
                    <div class="metric-value">${formatNumber(record.peakSupplyKw)} <small>万kW</small></div>
                </article>
                <article class="metric">
                    <div class="metric-label">予備率</div>
                    <div class="metric-value">${formatPercent(record.reserveRate)}</div>
                </article>
                <article class="metric">
                    <div class="metric-label">使用率</div>
                    <div class="metric-value">${formatPercent(record.usageRate)}</div>
                </article>
            </div>
            <div class="chart-wrap">${createSparkline(record.hourlyRows)}</div>
            <div class="spark-note">折れ線はCSVから読んだ当日需要の推移です。欠損時刻は線を描かず、そのまま残しています。</div>
        </section>
        <section class="panel">
            <div class="panel-head">
                <div>
                    <h3>時系列とCSV</h3>
                    <div class="panel-sub">その会社の当日データを上から追えるようにしています。</div>
                </div>
            </div>
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Time</th>
                            <th>Actual</th>
                            <th>Forecast</th>
                            <th>Usage</th>
                            <th>Capacity</th>
                        </tr>
                    </thead>
                    <tbody>${tableRows || '<tr><td colspan="5">時系列データなし</td></tr>'}</tbody>
                </table>
            </div>
            <div class="raw-wrap">
                <details>
                    <summary>生CSVを表示</summary>
                    <pre>${escapeHtml(record.raw)}</pre>
                </details>
            </div>
        </section>
    `;
}

function escapeHtml(text) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function render() {
    renderHeroMeta();
    renderOverview();
    renderCompanyGrid();
    renderDetails();
}

async function fetchCompany(company) {
    const response = await fetch(`proxy.php?company=${encodeURIComponent(company.id)}`, { cache: "no-store" });
    if (!response.ok) {
        throw new Error(`Proxy HTTP ${response.status}`);
    }

    const csvText = await readResponseText(response);
    state.records[company.id] = parseRecord(company, csvText);
}

async function runWithConcurrency(items, limit, worker) {
    const queue = [...items];
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (queue.length) {
            const item = queue.shift();
            try {
                await worker(item);
            } finally {
                state.loading.delete(item.id);
                render();
            }
        }
    });

    await Promise.all(runners);
}

async function init() {
    render();
    await runWithConcurrency(COMPANIES, 3, async (company) => {
        try {
            await fetchCompany(company);
        } catch (error) {
            console.error(`Failed to load ${company.id}:`, error);
        }
    });
}

init();
