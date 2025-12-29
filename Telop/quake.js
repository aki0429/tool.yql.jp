let ws;
let stationMap = {}; 
let japanGeoJSON = null;

const titleElem = document.getElementById('title');
const mainTextElem = document.getElementById('main-text');
const mapCanvas = document.getElementById('map-canvas');
const intensityDisplay = document.getElementById('intensity-display');
const logElem = document.getElementById('status-log');

// 10地域区分マッピング
const regionMapping = {
    "北海道": "北海道",
    "青森県": "東北", "岩手県": "東北", "宮城県": "東北", "秋田県": "東北", "山形県": "東北", "福島県": "東北",
    "茨城県": "関東", "栃木県": "関東", "群馬県": "関東", "埼玉県": "関東", "千葉県": "関東", "東京都": "関東", "神奈川県": "関東",
    "山梨県": "甲信越", "長野県": "甲信越", "新潟県": "甲信越",
    "三重県": "東海", "愛知県": "東海", "岐阜県": "東海", "静岡県": "東海",
    "福井県": "北陸", "石川県": "北陸", "富山県": "北陸",
    "滋賀県": "近畿", "京都府": "近畿", "大阪府": "近畿", "兵庫県": "近畿", "奈良県": "近畿", "和歌山県": "近畿",
    "鳥取県": "中国", "島根県": "中国", "岡山県": "中国", "広島県": "中国", "山口県": "中国",
    "徳島県": "四国", "香川県": "四国", "愛媛県": "四国", "高知県": "四国",
    "福岡県": "九州", "佐賀県": "九州", "長崎県": "九州", "熊本県": "九州", "大分県": "九州", "宮崎県": "九州", "鹿児島県": "九州", "沖縄県": "九州"
};

function updateLog(msg) {
    if (logElem) logElem.innerText = `[LOG] ${msg}`;
}

async function init() {
    try {
        const [resStations, resGeo] = await Promise.all([
            fetch('stations.json'),
            fetch('japan.geojson')
        ]);
        const stationData = await resStations.json();
        stationData.forEach(item => {
            if (item.name && item.city) stationMap[item.name] = item.city.name;
        });
        japanGeoJSON = await resGeo.json();
        updateLog("全データ読み込み完了。待機中。");
        connect();
    } catch (err) {
        updateLog("データ読み込み失敗。");
        connect();
    }
}

function connect() {
    ws = new WebSocket('https://api.p2pquake.net/v2/ws');
    ws.onmessage = (e) => {
        const data = JSON.parse(e.data);
        console.log("WebSocket受信データ(生):", data); 
        if ([551, 552, 554, 556].includes(data.code)) handleDisaster(data);
    };
    ws.onclose = () => setTimeout(connect, 5000);
}

async function handleDisaster(data) {
    try { new Audio('nc284095_ピーン・起動音、スタート、アイキャッチ_pibell.wav').play().catch(() => {}); } catch(e) {}

    if (data.code === 556) {
        titleElem.innerText = "緊急地震速報（警報）";
    } else {
        titleElem.innerText = "YQL 地震情報";
    }
    show(titleElem); await sleep(5000); hide(titleElem);

    if (data.code === 556) {
        const hypo = data.earthquake.hypocenter;
        mainTextElem.innerHTML = `${hypo.name}で地震発生<br>強い揺れに警戒してください`;
        show(mainTextElem);
        const warningAreas = data.areas.map(a => a.name);
        drawMap(warningAreas, hypo.latitude, hypo.longitude);
        show(mapCanvas);
        await sleep(10000);
        hide(mainTextElem); hide(mapCanvas);
        return;
    }

    if (data.code === 554) {
        const tsunamiGroups = formatTsunamiAreas(data.tsunami.areas);
        for (const html of tsunamiGroups) { intensityDisplay.innerHTML = html; show(intensityDisplay); await sleep(5000); hide(intensityDisplay); }
    } else {
        const time = data.time.split(' ')[1].substring(0, 5).replace(':', '時') + '分';
        const hasHypo = !!(data.earthquake && data.earthquake.hypocenter && data.earthquake.hypocenter.name);
        
        mainTextElem.innerHTML = generateSummary(data, time, hasHypo);
        show(mainTextElem); await sleep(5000); hide(mainTextElem);

        if (hasHypo) {
            const hypo = data.earthquake.hypocenter;
            mainTextElem.innerHTML = `震源：${hypo.name}<br>深さ：${hypo.depth === 0 ? "ごく浅い" : hypo.depth + "km"}　マグニチュード：${hypo.magnitude}`;
            show(mainTextElem); await sleep(5000); hide(mainTextElem);
            
            // 津波ステータス（条件によりスキップ）
            const tsunamiText = generateTsunamiStatusText(data.earthquake.domesticTsunami, data.earthquake.foreignTsunami);
            if (tsunamiText !== "") {
                mainTextElem.innerHTML = tsunamiText;
                show(mainTextElem); await sleep(5000); hide(mainTextElem);
            }
        }

        if (data.points && data.points.length > 0) {
            const groups = formatIntensityGroups(data.points);
            for (const htmlContent of groups) { intensityDisplay.innerHTML = htmlContent; show(intensityDisplay); await sleep(5000); hide(intensityDisplay); }
        }
    }
}

function generateSummary(data, time, hasHypo) {
    let maxScale = -1;
    if (data.points && data.points.length > 0) {
        maxScale = Math.max(...data.points.map(p => p.scale));
    }
    if (maxScale === -1 && hasHypo) {
        return `${time}ごろ地震がありました。`;
    }
    const firstPoint = data.points ? data.points[0] : null;
    let regionLabel = "各地";
    if (firstPoint) {
        const prefName = firstPoint.pref?.name || firstPoint.pref;
        regionLabel = regionMapping[prefName] || prefName || "各地";
    }
    let str = (maxScale >= 45) ? "強い" : (maxScale >= 40) ? "やや強い" : "";
    return `${time}ごろ${regionLabel}地方で${str}地震がありました。`;
}

// 【修正版】津波メッセージ生成：表記ゆれ対応とスキップ条件
function generateTsunamiStatusText(domestic, foreign) {
    const dom = domestic ? domestic.toLowerCase() : "";
    const forgn = foreign ? foreign.toLowerCase() : "";

    // 1. 国内警報（最優先）
    if (dom === "majorwarning") return "今すぐ逃げろ！大津波警報！今すぐ高いところへ！";
    if (dom === "warning") return "今すぐ沿岸部から離れて！津波警報が発表されています！高いところへ逃げて！";
    if (dom === "watch") return "注意報が発表されています今すぐ沿岸部や河口から離れてください";
    if (dom === "checking") return "津波については現在気象庁で調査しています。";

    // 2. 海外地震スキップ判定：foreign が unknown (大文字小文字問わず) ならスキップ
    if (forgn === "unknown") return ""; 
    
    // 3. 海外地震調査中・注意報
    if (forgn === "potential") return "海外で地震が発生しました。日本への津波の影響は現在調査中です。";
    if (forgn === "checking") return "太平洋で発生した地震による日本への津波の影響を現在調査中です。";
    if (forgn === "watch") return "遠地地震による津波注意報が発表されています。海岸から離れてください。";

    // 4. 平常時
    if (dom === "none" && (forgn === "none" || forgn === "")) return "この地震による津波の心配はありません";
    if (dom === "noneffective" || forgn === "noneffective") return "若干の海面変動が予想されますが被害の心配はありません";

    return "津波情報を確認してください。";
}

function formatIntensityGroups(points) {
    const cityMaxScales = {}; 
    points.forEach(p => {
        const cityName = stationMap[p.addr] || p.addr;
        const currentScale = p.scale;
        if (!cityMaxScales[cityName] || currentScale > cityMaxScales[cityName]) {
            cityMaxScales[cityName] = currentScale;
        }
    });
    const map = {};
    Object.keys(cityMaxScales).forEach(cityName => {
        const scaleVal = cityMaxScales[cityName];
        if (scaleVal === -1) return; 
        const maxS = convertScale(scaleVal);
        if (!map[maxS]) map[maxS] = new Set();
        map[maxS].add(cityName);
    });
    const res = [];
    const order = ["7", "6強", "6弱", "5強", "5弱", "4", "3", "2", "1"];
    order.forEach(scale => {
        if (map[scale]) {
            const addrs = Array.from(map[scale]).slice(0, 12);
            const l1 = addrs.slice(0, 6).join('　');
            const l2 = addrs.slice(6, 12).join('　');
            res.push(`<div class="intensity-row"><div class="label-box"><span class="scale-green">震度${scale}</span></div><div class="content-list">${l1}${l2 ? '<br>' + l2 : ''}</div></div>`);
        }
    });
    return res;
}

function formatTsunamiAreas(areas) {
    const grades = { "MajorWarning": [], "Warning": [], "Watch": [] };
    areas.forEach(a => { if (grades[a.grade]) grades[a.grade].push(a.name); });
    const res = [];
    const config = { "MajorWarning": { label: "大津波警報", cls: "tsunami-purple" }, "Warning": { label: "津波警報", cls: "tsunami-red" }, "Watch": { label: "津波注意報", cls: "tsunami-yellow" } };
    Object.keys(config).forEach(grade => {
        if (grades[grade].length > 0) {
            const list = grades[grade].slice(0, 12);
            const l1 = list.slice(0, 6).join('　');
            const l2 = list.slice(6, 12).join('　');
            res.push(`<div class="tsunami-row"><div class="label-box"><span class="${config[grade].cls}">${config[grade].label}</span></div><div class="content-list">${l1}${l2 ? '<br>' + l2 : ''}</div></div>`);
        }
    });
    return res;
}

function drawMap(warningAreas, hypoLat, hypoLon) {
    const ctx = mapCanvas.getContext('2d');
    const width = 1000; const height = 600;
    mapCanvas.width = width; mapCanvas.height = height;
    const project = (lon, lat) => {
        const x = (lon - 128) * 45;
        const y = height - (lat - 30) * 45;
        return [x, y];
    };
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "white"; ctx.lineWidth = 1.5;
    if (!japanGeoJSON) return;
    japanGeoJSON.features.forEach(feature => {
        const isWarning = warningAreas.some(area => feature.properties.name.includes(area) || area.includes(feature.properties.name));
        ctx.beginPath();
        feature.geometry.coordinates.forEach(polygon => {
            const coords = feature.geometry.type === "MultiPolygon" ? polygon[0] : polygon;
            coords.forEach((coord, i) => {
                const [x, y] = project(coord[0], coord[1]);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
        });
        if (isWarning) { ctx.fillStyle = "rgba(255, 0, 0, 0.7)"; ctx.fill(); }
        ctx.stroke();
    });
    if (hypoLat && hypoLon) {
        const [hx, hy] = project(hypoLon, hypoLat);
        ctx.strokeStyle = "yellow"; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(hx - 15, hy - 15); ctx.lineTo(hx + 15, hy + 15);
        ctx.moveTo(hx + 15, hy - 15); ctx.lineTo(hx - 15, hy + 15);
        ctx.stroke();
    }
}

function convertScale(s) { return {10:"1", 20:"2", 30:"3", 40:"4", 45:"5弱", 50:"5強", 55:"6弱", 60:"6強", 70:"7"}[s] || ""; }
function show(el) { if(el) el.classList.remove('hidden'); }
function hide(el) { if(el) el.classList.add('hidden'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

init();