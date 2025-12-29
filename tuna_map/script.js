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
const AREA_GEOJSON_FILE = "area.geojson";

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
let areaCodeMap = {
    "101": 0,    "102": 1,    "103": 2,    "104": 3,    "105": 4,    "106": 5,
    "201": 6,    "202": 7,    "210": 8,    "211": 9,    "212": 10,    "220": 11,
    "221": 12,    "222": 13,    "300": 14,    "301": 15,    "310": 16,    "320": 17,
    "321": 18,    "322": 19,    "323": 20,    "330": 21,    "340": 22,    "341": 23,
    "342": 24,    "343": 25,    "350": 26,    "351": 27,    "360": 28,    "361": 29,
    "362": 30,    "363": 31,    "370": 32,    "371": 33,    "372": 34,    "380": 35,
    "381": 36,    "382": 37,    "383": 38,    "384": 39,    "385": 40,    "386": 41,
    "387": 42,    "388": 43,    "389": 44,    "390": 45,    "391": 46,    "400": 47,
    "401": 48,    "402": 49,    "403": 50,    "404": 51,    "405": 52,    "406": 53,
    "407": 54,    "408": 55,    "409": 56,    "410": 57,    "411": 58,    "412": 59,
    "413": 60,    "414": 61,    "415": 62,    "416": 63
};

/* -------- Leaflet オプション & マップ -------- */
const mapOpts = {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    background: "#002255"
};

const mapMain      = L.map("map-main", mapOpts).setView([38.0, 137.0], 5.5);
const mapOkinawa   = L.map("map-okinawa", mapOpts).setView([25.5710691, 127.1698242], 5.2);
const mapOgasawara = L.map("map-ogasawara", mapOpts).setView([27.1068333, 142.1739444], 7.5);
const maps = [mapMain, mapOkinawa, mapOgasawara];

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
    if (msg) msg.innerText = "Loading GeoJSON...";

    try {
        const areaRes = await fetch(AREA_GEOJSON_FILE);
        const rawData = await areaRes.json();
        
        // GeometryCollection を Feature Collection に変換
        if (rawData.type === "GeometryCollection") {
            geoJsonData = {
                type: "FeatureCollection",
                features: rawData.geometries.map((geom, index) => {
                    // コードを逆引き
                    let code = null;
                    for (const [areaCode, idx] of Object.entries(areaCodeMap)) {
                        if (idx === index) {
                            code = areaCode;
                            break;
                        }
                    }
                    return {
                        type: "Feature",
                        properties: { code: code },
                        geometry: geom
                    };
                })
            };
            console.log("GeoJSON converted to FeatureCollection:", geoJsonData.features.length, "features");
        } else {
            geoJsonData = rawData;
        }
    } catch (e) {
        console.error("Failed to load area.geojson:", e);
        if (msg) msg.innerText = "area.geojson load error";
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
    // 条件付きで無効化する場合はここに追加 (例: ctrl 押下で無効)
    e.preventDefault();
    const menu = document.getElementById("debug-menu");
    if (!menu) return;
    menu.style.display = "block";
    // ページ外にはみ出さないように微調整
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const menuW = menu.offsetWidth || 220;
    const menuH = menu.offsetHeight || 40;
    let left = e.pageX;
    let top = e.pageY;
    if (left + menuW > winW) left = winW - menuW - 8;
    if (top + menuH > winH) top = winH - menuH - 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
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
