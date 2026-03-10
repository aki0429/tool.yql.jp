/* ---------------------------------------------------------
   script.js
   - 地図初期化、JMA取得、描画、右クリックデバッグ
   - HTML側に以下の要素が存在する前提:
     #map-main, #map-okinawa, #map-ogasawara,
     .header-info 内の #monitor-msg,
     #debug-menu > li#menu-load-test
   - 必要ファイル: area.geojson, test.json, proxy.php (optional)
--------------------------------------------------------- */

/* -------- 定数 -------- */
const JMA_LIST_URL     = "https://www.jma.go.jp/bosai/tsunami/data/list.json";
const JMA_DATA_BASE    = "https://www.jma.go.jp/bosai/tsunami/data/";
const AREA_GEOJSON_DIR = "geojson";

const WARNING_STYLES = {
    "大津波警報":                 { color: "#aa00aa", weight: 8 },
    "津波警報":                   { color: "#ff0000", weight: 6 },
    "津波注意報":                 { color: "#ffff00", weight: 5 },
    "津波予報（若干の海面変動）": { color: "#00aaff", weight: 3 }
};

/* -------- アプリ状態 -------- */
let activeWarnings = {};
let currentJsonFile = "";
let geoJsonData = null;
let geoJsonLayers = [];
let isTestMode = false;
let isDebugMode = false;
let areaGeoStatus = {};
let debugHighlightLayers = [];
const AREA_LIST = [
    { code: "100", name: "北海道太平洋沿岸東部" },
    { code: "101", name: "北海道太平洋沿岸中部" },
    { code: "102", name: "北海道太平洋沿岸西部" },
    { code: "110", name: "北海道日本海沿岸北部" },
    { code: "111", name: "北海道日本海沿岸南部" },
    { code: "120", name: "オホーツク海沿岸" },
    { code: "200", name: "青森県日本海沿岸" },
    { code: "201", name: "青森県太平洋沿岸" },
    { code: "202", name: "陸奥湾" },
    { code: "210", name: "岩手県" },
    { code: "220", name: "宮城県" },
    { code: "230", name: "秋田県" },
    { code: "240", name: "山形県" },
    { code: "250", name: "福島県" },
    { code: "300", name: "茨城県" },
    { code: "310", name: "千葉県九十九里・外房" },
    { code: "311", name: "千葉県内房" },
    { code: "312", name: "東京湾内湾" },
    { code: "320", name: "伊豆諸島" },
    { code: "321", name: "小笠原諸島" },
    { code: "330", name: "相模湾・三浦半島" },
    { code: "340", name: "新潟県上中下越" },
    { code: "341", name: "佐渡" },
    { code: "350", name: "富山県" },
    { code: "360", name: "石川県能登" },
    { code: "361", name: "石川県加賀" },
    { code: "370", name: "福井県" },
    { code: "380", name: "静岡県" },
    { code: "390", name: "愛知県外海" },
    { code: "391", name: "伊勢・三河湾" },
    { code: "400", name: "三重県南部" },
    { code: "500", name: "京都府" },
    { code: "510", name: "大阪府" },
    { code: "520", name: "兵庫県北部" },
    { code: "521", name: "兵庫県瀬戸内海沿岸" },
    { code: "522", name: "淡路島南部" },
    { code: "530", name: "和歌山県" },
    { code: "540", name: "鳥取県" },
    { code: "550", name: "島根県出雲・石見" },
    { code: "551", name: "隠岐" },
    { code: "560", name: "岡山県" },
    { code: "570", name: "広島県" },
    { code: "580", name: "徳島県" },
    { code: "590", name: "香川県" },
    { code: "600", name: "愛媛県宇和海沿岸" },
    { code: "601", name: "愛媛県瀬戸内海沿岸" },
    { code: "610", name: "高知県" },
    { code: "700", name: "山口県日本海沿岸" },
    { code: "701", name: "山口県瀬戸内海沿岸" },
    { code: "710", name: "福岡県瀬戸内海沿岸" },
    { code: "711", name: "福岡県日本海沿岸" },
    { code: "712", name: "有明・八代海" },
    { code: "720", name: "佐賀県北部" },
    { code: "730", name: "長崎県西方" },
    { code: "731", name: "壱岐・対馬" },
    { code: "740", name: "熊本県天草灘沿岸" },
    { code: "750", name: "大分県瀬戸内海沿岸" },
    { code: "751", name: "大分県豊後水道沿岸" },
    { code: "760", name: "宮崎県" },
    { code: "770", name: "鹿児島県東部" },
    { code: "771", name: "種子島・屋久島地方" },
    { code: "772", name: "奄美群島・トカラ列島" },
    { code: "773", name: "鹿児島県西部" },
    { code: "800", name: "沖縄本島地方" },
    { code: "801", name: "大東島地方" },
    { code: "802", name: "宮古島・八重山地方" }
];

function normalizeToFeatures(rawData) {
    if (!rawData) return [];
    if (rawData.type === "FeatureCollection" && Array.isArray(rawData.features)) {
        return rawData.features;
    }
    if (rawData.type === "Feature") {
        return [rawData];
    }
    if (rawData.type === "GeometryCollection" && Array.isArray(rawData.geometries)) {
        return rawData.geometries.map(geom => ({
            type: "Feature",
            properties: {},
            geometry: geom
        }));
    }
    return [];
}

function setDebugMode(enabled) {
    isDebugMode = enabled;
    const panel = document.getElementById("debug-panel");
    if (!panel) return;
    if (enabled) {
        panel.classList.remove("is-hidden");
    } else {
        panel.classList.add("is-hidden");
    }
}

function clearDebugHighlight() {
    debugHighlightLayers.forEach(layer =>
        maps.forEach(map => {
            if (map.hasLayer(layer)) map.removeLayer(layer);
        })
    );
    debugHighlightLayers = [];
}

function highlightAreaByCode(code) {
    if (!geoJsonData || !code) return;
    clearDebugHighlight();
    const features = geoJsonData.features.filter(
        feature => feature.properties?.code === code
    );
    if (features.length === 0) return;

    maps.forEach(map => {
        const layer = L.geoJson(features, {
            style: {
                color: "#00ffd1",
                weight: 6,
                opacity: 1,
                fillColor: "#00ffd1",
                fillOpacity: 0.15
            }
        });
        layer.addTo(map);
        debugHighlightLayers.push(layer);
    });
}

function updateDebugAreaInfo(code) {
    const statusEl = document.getElementById("debug-area-status");
    const infoEl = document.getElementById("debug-area-info");
    if (!statusEl || !infoEl) return;

    const status = areaGeoStatus[code];
    if (!status) {
        statusEl.textContent = "未登録";
        infoEl.textContent = "エリア情報が見つかりません。";
        return;
    }

    if (status.loaded) {
        statusEl.textContent = `割当済み: OK (features: ${status.featureCount})`;
    } else if (status.status === "missing") {
        statusEl.textContent = "未割当: ファイルなし";
    } else if (status.status === "empty") {
        statusEl.textContent = "未割当: feature 0";
    } else {
        statusEl.textContent = "未割当: 読み込み失敗";
    }

    infoEl.textContent = `コード: ${status.code} / 名称: ${status.name} / ファイル: ${status.filePath}`;
}

function setupDebugPanel() {
    const select = document.getElementById("debug-area-select");
    if (!select || select.dataset.ready === "true") return;

    AREA_LIST.forEach(area => {
        const option = document.createElement("option");
        option.value = area.code;
        option.textContent = `${area.name} [${area.code}]`;
        select.appendChild(option);
    });

    select.addEventListener("change", () => {
        updateDebugAreaInfo(select.value);
    });

    const btnHighlight = document.getElementById("debug-highlight");
    if (btnHighlight) {
        btnHighlight.addEventListener("click", () => {
            highlightAreaByCode(select.value);
        });
    }

    const btnClear = document.getElementById("debug-clear-highlight");
    if (btnClear) {
        btnClear.addEventListener("click", () => {
            clearDebugHighlight();
        });
    }

    const btnLoadTest = document.getElementById("debug-load-test");
    if (btnLoadTest) {
        btnLoadTest.addEventListener("click", () => {
            loadDebugJson();
        });
    }

    const btnExitTest = document.getElementById("debug-exit-test");
    if (btnExitTest) {
        btnExitTest.addEventListener("click", () => {
            exitTestMode();
        });
    }

    const btnClose = document.getElementById("debug-close");
    if (btnClose) {
        btnClose.addEventListener("click", () => {
            setDebugMode(false);
        });
    }

    select.dataset.ready = "true";
    updateDebugAreaInfo(select.value || AREA_LIST[0]?.code);
}

/* -------- Leaflet オプション & マップ -------- */
const mapOpts = {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    preferCanvas: true,
    background: "#002255"
};

const mapMain      = L.map("map-main", mapOpts).setView([38.0, 137.0], 5.5);
const mapOkinawa   = L.map("map-okinawa", mapOpts).setView([25.5710691, 127.1698242], 5.2);
const mapOgasawara = L.map("map-ogasawara", mapOpts).setView([27.1068333, 142.1739444], 7.5);
const maps = [mapMain, mapOkinawa, mapOgasawara];

const refreshMapSizes = () => {
    maps.forEach(map => map.invalidateSize());
};

let resizeTimer;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(refreshMapSizes, 120);
});
window.addEventListener("load", refreshMapSizes);

/* ---------------------------------------------------------
   fetch via proxy wrapper
   - proxy.php を使う前提の実装。直接 fetch したければ
     fetchViaProxy を置き換えてください。
--------------------------------------------------------- */
async function fetchViaProxy(url) {
    const ts = Date.now();
    const noCache = url + (url.includes("?") ? "&" : "?") + "_=" + ts;
    // デバッグ: proxy.php をスキップして直接 fetch
    try {
        const res = await fetch(noCache);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    } catch (e) {
        console.warn("Direct fetch failed, trying proxy:", e);
        const res = await fetch("proxy.php?url=" + encodeURIComponent(noCache));
        return res.json();
    }
}

/* ---------------------------------------------------------
   初期処理
--------------------------------------------------------- */
async function initApp() {
    const msg = document.getElementById("monitor-msg");
    if (msg) msg.innerText = `Loading ${AREA_GEOJSON_DIR}...`;

    try {
        areaGeoStatus = {};
        const loaded = await Promise.all(
            AREA_LIST.map(async area => {
                const filePath = `${AREA_GEOJSON_DIR}/${area.name}.geojson`;
                try {
                    const res = await fetch(filePath);
                    if (!res.ok) {
                        areaGeoStatus[area.code] = {
                            code: area.code,
                            name: area.name,
                            filePath: filePath,
                            loaded: false,
                            featureCount: 0,
                            status: "missing"
                        };
                        console.warn("GeoJSON not found:", filePath, res.status);
                        return [];
                    }
                    const raw = await res.json();
                    const features = normalizeToFeatures(raw).map(feature => ({
                        ...feature,
                        properties: {
                            ...(feature.properties || {}),
                            code: area.code,
                            name: area.name
                        }
                    }));
                    areaGeoStatus[area.code] = {
                        code: area.code,
                        name: area.name,
                        filePath: filePath,
                        loaded: features.length > 0,
                        featureCount: features.length,
                        status: features.length > 0 ? "ok" : "empty"
                    };
                    return features;
                } catch (e) {
                    areaGeoStatus[area.code] = {
                        code: area.code,
                        name: area.name,
                        filePath: filePath,
                        loaded: false,
                        featureCount: 0,
                        status: "error"
                    };
                    console.error("GeoJSON load error:", filePath, e);
                    return [];
                }
            })
        );
        const features = loaded.flat();
        if (features.length === 0) {
            throw new Error("No area GeoJSON features loaded.");
        }
        geoJsonData = { type: "FeatureCollection", features };
        console.log("GeoJSON loaded from folder:", features.length, "features");
        setupDebugPanel();
    } catch (e) {
        console.error(`Failed to load ${AREA_GEOJSON_DIR}:`, e);
        if (msg) msg.innerText = `${AREA_GEOJSON_DIR} load error`;
        return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.has("test")) {
        await loadDebugJson();
        return;
    }

    if (msg) msg.innerText = "Starting monitor...";
    await checkUpdate();

    // 1秒間隔で確認
    setInterval(checkUpdate, 1000);
}

/* ---------------------------------------------------------
   気象庁リスト取得・更新判定
--------------------------------------------------------- */
async function checkUpdate() {
    // テストモード中はスキップ
    if (isTestMode) return;
    
    const msg = document.getElementById("monitor-msg");

    try {
        const listJson = await fetchViaProxy(JMA_LIST_URL);

        const targetItem = listJson.find(item =>
            item?.jsonFile?.includes("VTSE41") || item?.jsonFile?.includes("VTSE40")
        );

        if (!targetItem) {
            currentJsonFile = "NONE";
            activeWarnings = {};
            drawMap();
            if (msg) msg.innerText = "No VTSE40/41; cleared.";
            return;
        }

        if (targetItem.jsonFile === currentJsonFile) return;

        currentJsonFile = targetItem.jsonFile;
        const detailJson = await fetchViaProxy(JMA_DATA_BASE + targetItem.jsonFile);

        parseDetailData(detailJson);
        drawMap();

        if (msg) msg.innerText = `Loaded ${currentJsonFile}`;
    } catch (e) {
        console.error("checkUpdate error:", e);
        if (msg) msg.innerText = "Update error";
    }
}

/* ---------------------------------------------------------
   JSON から activeWarnings を作る
   - JMA の JSON フォーマットに依存
   - WARNING_STYLES に定義されている警報種別のみを登録
--------------------------------------------------------- */
function parseDetailData(json) {
    activeWarnings = {};

    let items = json.Body?.Tsunami?.Forecast?.Item;
    if (!items) {
        console.warn("No items found in json.Body?.Tsunami?.Forecast?.Item");
        return;
    }

    if (!Array.isArray(items)) items = [items];

    console.log("Processing", items.length, "items");
    items.forEach(item => {
        const code = item.Area?.Code;
        const kind = item.Category?.Kind?.Name;
        console.log("Item:", { code, kind, item });
        // WARNING_STYLES に定義されている警報種別のみを登録
        if (code && kind && WARNING_STYLES[kind]) {
            activeWarnings[code] = kind;
        }
    });
    console.log("activeWarnings after parse:", activeWarnings);
}

/* ---------------------------------------------------------
   地図描画
--------------------------------------------------------- */
function drawMap() {
    if (!geoJsonData) {
        console.warn("geoJsonData not loaded");
        return;
    }

    console.log("Drawing map with activeWarnings:", activeWarnings);

    // 既存レイヤー除去
    geoJsonLayers.forEach(layer =>
        maps.forEach(map => {
            if (map.hasLayer(layer)) map.removeLayer(layer);
        })
    );
    geoJsonLayers = [];

    maps.forEach(map => {
        const layer = L.geoJson(geoJsonData, {
            style: feature => {
                const code = feature.properties?.code;
                const warn = activeWarnings[code];
                
                if (code) {
                    console.log("Feature code:", code, "warn:", warn);
                }

                if (warn && WARNING_STYLES[warn]) {
                    const s = WARNING_STYLES[warn];
                    return {
                        color: s.color,
                        weight: s.weight,
                        opacity: 1,
                        fillColor: s.color,
                        fillOpacity: 0.4
                    };
                }

                return {
                    color: "#ffffff",
                    weight: 2,
                    opacity: 0.8,
                    fillOpacity: 0
                };
            }
        });

        layer.addTo(map);
        geoJsonLayers.push(layer);
    });

    // 凡例を更新
    updateLegend();
}

/* ---------------------------------------------------------
   凡例を動的に更新
   - activeWarnings に含まれる警報種別のみを表示
--------------------------------------------------------- */
function updateLegend() {
    const legend = document.getElementById("legend");
    if (!legend) return;

    // 現在の警報種別を集計
    const warningTypes = new Set(Object.values(activeWarnings));

    // 凡例の各要素を制御
    const legendItems = {
        "大津波警報": document.getElementById("legend-daitsunami"),
        "津波警報": document.getElementById("legend-tsunami"),
        "津波注意報": document.getElementById("legend-tyuui"),
        "津波予報（若干の海面変動）": document.getElementById("legend-yosoku")
    };

    let hasWarning = false;
    for (const [warnType, element] of Object.entries(legendItems)) {
        if (element) {
            if (warningTypes.has(warnType)) {
                element.style.display = "flex";
                hasWarning = true;
            } else {
                element.style.display = "none";
            }
        }
    }

    // 警報がない場合は凡例全体を非表示
    legend.style.display = hasWarning ? "block" : "none";
}

/* ---------------------------------------------------------
   デバッグ: test.json を読み込んで強制描画
   - test.json は JMA の詳細 JSON フォーマットを模したもの
--------------------------------------------------------- */
async function loadDebugJson() {
    isTestMode = true;
    const msg = document.getElementById("monitor-msg");
    if (msg) msg.innerText = "Loading test.json (debug)...";

    try {
        const res = await fetch("test.json");
        const data = await res.json();
        
        console.log("test.json loaded:", data);

        currentJsonFile = "DEBUG";
        parseDetailData(data);
        drawMap();

        if (msg) msg.innerText = "Debug mode: test.json loaded!";
    } catch (e) {
        console.error("loadDebugJson error:", e);
        if (msg) msg.innerText = "Debug load error: " + e.message;
    }
}

/* ---------------------------------------------------------
   テストモード解除
--------------------------------------------------------- */
function exitTestMode() {
    isTestMode = false;
    currentJsonFile = "";
    activeWarnings = {};
    const msg = document.getElementById("monitor-msg");
    if (msg) msg.innerText = "Test mode exited. Awaiting JMA updates...";
    drawMap();
}

/* ---------------------------------------------------------
   カスタム右クリックメニュー制御
   - HTML 側に #debug-menu と #menu-load-test があること
--------------------------------------------------------- */
document.addEventListener("contextmenu", function(e) {
    // 右クリックでデバッグモードを開く
    e.preventDefault();
    const menu = document.getElementById("debug-menu");
    if (menu) menu.style.display = "none";
    setDebugMode(true);
    setupDebugPanel();
});

document.addEventListener("click", function() {
    const menu = document.getElementById("debug-menu");
    if (menu) menu.style.display = "none";
});

const menuItem = document.getElementById("menu-load-test");
if (menuItem) {
    menuItem.addEventListener("click", () => {
        loadDebugJson();
    });
}

const menuExitTest = document.getElementById("menu-exit-test");
if (menuExitTest) {
    menuExitTest.addEventListener("click", () => {
        exitTestMode();
    });
}

/* ---------------------------------------------------------
   起動
--------------------------------------------------------- */
initApp();
