let ws;
let stationMap = {}; 
let japanGeoJSON = null;

const titleElem = document.getElementById('title');
const mainTextElem = document.getElementById('main-text');
const mapCanvas = document.getElementById('map-canvas');
const intensityDisplay = document.getElementById('intensity-display');
const logElem = document.getElementById('status-log');

// EEW警報専用要素
const eewLayout = document.getElementById('eew-layout');
const eewMapCanvas = document.getElementById('eew-map-canvas');
const eewAreasList = document.getElementById('eew-areas-list');

// メッセージキューと処理管理
let messageQueue = [];
let isProcessing = false;
let shouldCancelCurrent = false;

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

// 震源地名から都道府県への変換（points が空の場合用）
const shogenMapping = {
    "十勝": "北海道", "釧路": "北海道", "網走": "北海道", "稚内": "北海道", "札幌": "北海道", "後志": "北海道", "胆振": "北海道", "日高": "北海道",
    "青森": "東北", "岩手": "東北", "宮城": "東北", "秋田": "東北", "山形": "東北", "福島": "東北",
    "茨城": "関東・関東・甲信越・関東・甲信越", "栃木": "関東・関東・甲信越", "群馬": "関東・関東・甲信越", "埼玉": "関東・関東・甲信越", "千葉": "関東・関東・甲信越", "東京": "関東・関東・甲信越", "神奈川": "関東・関東・甲信越",
    "山梨": "関東・甲信越", "長野": "関東・甲信越", "新潟": "関東・甲信越",
    "静岡": "東海", "愛知": "東海", "岐阜": "東海", "三重": "東海",
    "福井": "北陸", "石川": "北陸", "富山": "北陸",
    "滋賀": "近畿", "京都": "近畿", "大阪": "近畿", "兵庫": "近畿", "奈良": "近畿", "和歌山": "近畿",
    "鳥取": "中国", "島根": "中国", "岡山": "中国", "広島": "中国", "山口": "中国",
    "徳島": "四国", "香川": "四国", "愛媛": "四国", "高知": "四国",
    "福岡": "九州", "佐賀": "九州", "長崎": "九州", "熊本": "九州", "大分": "九州", "宮崎": "九州", "鹿児島": "九州", "沖縄": "九州"
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
    
    ws.onopen = () => {
        console.log("WebSocket接続成功");
        updateLog("WebSocket接続成功");
    };
    
    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            // 受信データをそのままコンソール出力
            console.log("=== WebSocket受信データ ===");
            console.log("生データ:", e.data);
            console.log("パース後:", data);
            console.log("code:", data.code);
            console.log("=====================================");
            
            if ([551, 552, 553, 554, 556].includes(data.code)) {
                console.log("処理対象コード:", data.code, "をキューに追加");
                messageQueue.push(data);
                // 処理中の場合はキャンセルフラグを立てる
                if (isProcessing) {
                    shouldCancelCurrent = true;
                    console.log("新しいメッセージ受信。現在の処理をキャンセル予定");
                }
                processQueue();
            } else {
                console.log("処理対象外コード:", data.code);
            }
        } catch (err) {
            console.error("JSON解析エラー:", err);
            console.error("受信データ:", e.data);
        }
    };
    
    ws.onerror = (err) => {
        console.error("WebSocketエラー:", err);
        updateLog("WebSocketエラー");
    };
    
    ws.onclose = () => {
        console.log("WebSocket接続切断。5秒後に再接続します");
        updateLog("接続切断");
        setTimeout(connect, 5000);
    };
}

async function processQueue() {
    if (isProcessing || messageQueue.length === 0) return;
    
    console.log("キュー処理開始。キュー内容:", messageQueue.length, "件");
    isProcessing = true;
    shouldCancelCurrent = false;
    const data = messageQueue.shift();
    
    console.log("処理データ:", data);
    
    // キューに次のメッセージがある場合は2回表示をスキップ
    const isFastMode = messageQueue.length >= 1;
    const sleepTime = isFastMode ? 4000 : 7000;
    const repeatCount = isFastMode ? 0 : 2;
    
    console.log("モード:", isFastMode ? "高速" : "通常", "表示時間:", sleepTime, "ms", "繰り返し回数:", repeatCount);
    
    await handleDisaster(data, sleepTime, repeatCount);
    
    console.log("キュー処理完了");
    isProcessing = false;
    if (messageQueue.length > 0 && !shouldCancelCurrent) {
        setTimeout(processQueue, 100);
    } else if (shouldCancelCurrent && messageQueue.length > 0) {
        shouldCancelCurrent = false;
        processQueue();
    }
}

async function handleDisaster(data, sleepTime = 7000, repeatCount = 2) {
    try { new Audio('nc284095_ピーン・起動音、スタート、アイキャッチ_pibell.wav').play().catch(() => {}); } catch(e) {}

    // キャンセルされた場合は処理を中断
    if (shouldCancelCurrent) {
        console.log("現在の処理がキャンセルされました");
        return;
    }

    if (data.code === 556) {
        // EEW警報時は新しいレイアウトを表示
        await displayEEWAlert(data);
        return;
    }

    if (data.code === 554) {
        // 津波情報のみ
        const tsunamiGroups = formatTsunamiAreas(data.tsunami.areas);
        for (const html of tsunamiGroups) { 
            if (shouldCancelCurrent) return;
            intensityDisplay.innerHTML = html; show(intensityDisplay); await sleep(sleepTime); hide(intensityDisplay); 
        }
        return;
    }

    const time = data.time.split(' ')[1].substring(0, 5).replace(':', '時') + '分';
    const hasHypo = !!(data.earthquake && data.earthquake.hypocenter && data.earthquake.hypocenter.name);
    const hasPoints = data.points && data.points.length > 0;
    let maxScale = -1;
    if (hasPoints) maxScale = Math.max(...data.points.map(p => p.scale));

    if (data.code === 551) {
        // 震度速報 - 地震情報と震源情報を分割表示
        for (let repeat = 0; repeat <= repeatCount; repeat++) {
            // 2回目以降のみキャンセル判定（1回目は完全に表示）
            if (repeat > 0 && shouldCancelCurrent) return;
            
            // タイトル表示（1回目のみ）
            if (repeat === 0) {
                titleElem.innerText = "YQL 地震情報";
                show(titleElem); await sleep(sleepTime); hide(titleElem);
            }

            if (repeat > 0 && shouldCancelCurrent) return;
            
            // サマリー（地域、震度速報）のみを表示
            mainTextElem.innerHTML = generateSummary551(data, time, maxScale);
            show(mainTextElem); await sleep(sleepTime); hide(mainTextElem);

            // 震源情報がある場合、別途表示
            if (repeat > 0 && shouldCancelCurrent) return;
            const hypocenterInfo = generateHypocenterInfo(data);
            if (hypocenterInfo) {
                mainTextElem.innerHTML = hypocenterInfo;
                show(mainTextElem); await sleep(sleepTime); hide(mainTextElem);
            }

            // 震度4以上の場合、揺れが強かった沿岸部では津波に注意の案内を表示
            if (maxScale >= 40) {
                if (repeat > 0 && shouldCancelCurrent) return;
                mainTextElem.innerHTML = "揺れが強かった沿岸部では<br>念のため津波に注意してください";
                show(mainTextElem); await sleep(sleepTime); hide(mainTextElem);
            }

            // 震度情報
            if (hasPoints) {
                const groups = formatIntensityGroups(data.points);
                for (const htmlContent of groups) { 
                    if (repeat > 0 && shouldCancelCurrent) return;
                    intensityDisplay.innerHTML = htmlContent; show(intensityDisplay); await sleep(sleepTime); hide(intensityDisplay); 
                }
            }
        }
    } else if (data.code === 552 || data.code === 553) {
        // 震度情報 / 震度確定
        titleElem.innerText = "YQL 地震情報";
        show(titleElem); await sleep(sleepTime); hide(titleElem);

        if (shouldCancelCurrent) return;

        mainTextElem.innerHTML = generateTimeMessage(time);
        show(mainTextElem); await sleep(sleepTime); hide(mainTextElem);

        // 津波情報：震源情報や震度確定などで津波情報がある場合に表示
        const hasTsunamiInfo = data.earthquake && (data.earthquake.domesticTsunami || data.earthquake.foreignTsunami);
        if (hasTsunamiInfo) {
            if (shouldCancelCurrent) return;
            const tsunamiText = generateTsunamiStatusText(
                data.earthquake.domesticTsunami,
                data.earthquake.foreignTsunami,
                { maxScale }
            );
            if (tsunamiText !== "") {
                mainTextElem.innerHTML = tsunamiText;
                show(mainTextElem); await sleep(sleepTime); hide(mainTextElem);
            }
        }

        // 震源情報
        if (hasHypo) {
            if (shouldCancelCurrent) return;
            const hypo = data.earthquake.hypocenter;
            const depthText = hypo.depth < 10 ? "ごく浅い" : hypo.depth + "km";
            mainTextElem.innerHTML = `震源地は${hypo.name}<br>深さ　${depthText}　マグニチュード${hypo.magnitude.toFixed(1)}`;
            show(mainTextElem); await sleep(sleepTime); hide(mainTextElem);
        }

        // 震度情報
        if (hasPoints) {
            if (shouldCancelCurrent) return;
            const groups = formatIntensityGroups(data.points);
            for (const htmlContent of groups) { 
                if (shouldCancelCurrent) return;
                intensityDisplay.innerHTML = htmlContent; show(intensityDisplay); await sleep(sleepTime); hide(intensityDisplay); 
            }
        }
    }
}

function generateSummary551(data, time, maxScale) {
    let regionLabel = "";
    
    // pointsから最大震度を観測した地域を特定
    if (data.points && data.points.length > 0) {
        // 各地域ごとに最大震度を観測した地点数をカウント
        const regionCounts = {};
        data.points.forEach(p => {
            if (p.scale === maxScale) {
                const prefName = p.pref?.name || p.pref;
                const region = regionMapping[prefName] || prefName || "";
                if (region) {
                    regionCounts[region] = (regionCounts[region] || 0) + 1;
                }
            }
        });
        
        // 最も多くの地点が最大震度を観測した地域を選ぶ
        let maxCountRegion = "";
        let maxCount = 0;
        Object.entries(regionCounts).forEach(([region, count]) => {
            if (count > maxCount) {
                maxCount = count;
                maxCountRegion = region;
            }
        });
        
        if (maxCountRegion) {
            regionLabel = maxCountRegion + '地方で';
        }
    }
    
    let str = (maxScale >= 50) ? "強い" : (maxScale >= 40) ? "やや強い" : "";
    return `${time}ごろ${regionLabel}<br>${str}地震がありました`;
}

function generateHypocenterInfo(data) {
    if (!data.earthquake || !data.earthquake.hypocenter) return "";
    const hypo = data.earthquake.hypocenter;
    const depthText = hypo.depth < 10 ? "ごく浅い" : hypo.depth + "km";
    return `震源地は${hypo.name}<br>深さ　${depthText}　マグニチュード${hypo.magnitude.toFixed(1)}`;
}

function generateTimeMessage(time) {
    return `${time}ごろ地震がありました`;
}

// 【修正版】津波メッセージ生成：表記ゆれ対応とスキップ条件
function generateTsunamiStatusText(domestic, foreign, options = {}) {
    const { maxScale = -1 } = options;
    const dom = domestic ? domestic.toLowerCase() : "";
    const forgn = foreign ? foreign.toLowerCase() : "";

    // 1. 国内警報（最優先）
    if (dom === "majorwarning") return "今すぐ逃げろ！大津波警報！今すぐ高いところへ！";
    if (dom === "warning") return "今すぐ沿岸部から離れて！津波警報が発表されています！高いところへ逃げて！";
    if (dom === "watch") return "注意報が発表されています今すぐ沿岸部や河口から離れてください";

    // 1.5 調査中（checking）: 震度4以上なら「念のため」、それ以外は注意喚起
    if (dom === "checking" || forgn === "checking") {
        if (maxScale >= 40) return "揺れが強かった沿岸部では<br>念のため津波に注意してください";
        return "津波については現在気象庁で調査しています。<br> 今後の情報に注意してください。";
    }

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
            const allAddrs = Array.from(map[scale]);
            // 2行表示：1行27文字以内、2行合計54文字以内の制限
            const separator = '　'; // 1文字
            const maxCharsPerLine = 27;
            const maxCharsTotal = 54;
            
            let i = 0;
            while (i < allAddrs.length) {
                let line1 = '';
                let line2 = '';
                
                // 1行目を作成
                while (i < allAddrs.length) {
                    const testLine = line1 ? line1 + separator + allAddrs[i] : allAddrs[i];
                    if (testLine.length <= maxCharsPerLine) {
                        line1 = testLine;
                        i++;
                    } else {
                        break;
                    }
                }
                
                // 2行目を作成（残り容量を使用）
                const remainingCapacity = maxCharsTotal - line1.length - (line1 ? 1 : 0); // 改行タグ分
                while (i < allAddrs.length && remainingCapacity > 0) {
                    const testLine = line2 ? line2 + separator + allAddrs[i] : allAddrs[i];
                    if (testLine.length <= remainingCapacity && testLine.length <= maxCharsPerLine) {
                        line2 = testLine;
                        i++;
                    } else {
                        break;
                    }
                }
                
                res.push(`<div class="intensity-row"><div class="label-box"><span class="scale-green">震度${scale}</span></div><div class="content-list">${line1}${line2 ? '<br>' + line2 : ''}</div></div>`);
            }
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
    // レスポンシブ対応（要素サイズに合わせる） + DPR対応
    const width = mapCanvas.clientWidth || 1000;
    const height = mapCanvas.clientHeight || Math.round(width * 0.6);
    const dpr = window.devicePixelRatio || 1;
    mapCanvas.width = Math.round(width * dpr);
    mapCanvas.height = Math.round(height * dpr);
    mapCanvas.style.width = width + 'px';
    mapCanvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = width / 1000;
    const sy = height / 600;
    const project = (lon, lat) => {
        const x = (lon - 128) * 45 * sx;
        const y = height - (lat - 30) * 45 * sy;
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

async function displayEEWAlert(data) {
    // 対象エリア情報を取得
    const warningAreas = data.areas.map(a => a.name);
    const hypo = data.earthquake.hypocenter;
    
    // EEWマップを描画
    drawEEWMap(warningAreas, hypo.latitude, hypo.longitude);
    
    // エリアリストを表示
    eewAreasList.innerHTML = warningAreas.map(area => `<div>${area}</div>`).join('');
    
    // EEWレイアウトを表示
    show(eewLayout);
    
    // 15秒表示を続ける
    await sleep(15000);
    
    // 非表示にする
    hide(eewLayout);
}

function drawEEWMap(warningAreas, hypoLat, hypoLon) {
    const ctx = eewMapCanvas.getContext('2d');
    const width = eewMapCanvas.clientWidth || 500;
    const height = eewMapCanvas.clientHeight || 350;
    eewMapCanvas.width = width;
    eewMapCanvas.height = height;
    
    if (!japanGeoJSON) return;
    
    // 警報エリアの範囲を計算
    let minLon = 180, maxLon = 0, minLat = 90, maxLat = 0;
    let hasWarningArea = false;
    
    japanGeoJSON.features.forEach(feature => {
        const isWarning = warningAreas.some(area => feature.properties.name.includes(area) || area.includes(feature.properties.name));
        if (isWarning) {
            hasWarningArea = true;
            feature.geometry.coordinates.forEach(polygon => {
                const coords = feature.geometry.type === "MultiPolygon" ? polygon[0] : polygon;
                coords.forEach(coord => {
                    minLon = Math.min(minLon, coord[0]);
                    maxLon = Math.max(maxLon, coord[0]);
                    minLat = Math.min(minLat, coord[1]);
                    maxLat = Math.max(maxLat, coord[1]);
                });
            });
        }
    });
    
    // 投影範囲を計算（パディング付き）
    let centerLon = (minLon + maxLon) / 2;
    let centerLat = (minLat + maxLat) / 2;
    let lonRange = Math.max(maxLon - minLon, 8); // 最小範囲確保
    let latRange = Math.max(maxLat - minLat, 8);
    
    // キャンバスアスペクト比に合わせてスケール調整
    const aspectRatio = width / height;
    if (lonRange / latRange > aspectRatio) {
        latRange = lonRange / aspectRatio;
    } else {
        lonRange = latRange * aspectRatio;
    }
    
    // パディング追加（10%）
    lonRange *= 1.1;
    latRange *= 1.1;
    
    const project = (lon, lat) => {
        const x = ((lon - (centerLon - lonRange / 2)) / lonRange) * width;
        const y = height - ((lat - (centerLat - latRange / 2)) / latRange) * height;
        return [x, y];
    };
    
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = "white";
    ctx.lineWidth = 1.5;
    
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
        if (isWarning) { 
            ctx.fillStyle = "rgba(255, 30, 68, 0.8)"; 
            ctx.fill(); 
        }
        ctx.stroke();
    });
    
    // 震源を表示
    if (hypoLat && hypoLon) {
        const [hx, hy] = project(hypoLon, hypoLat);
        ctx.strokeStyle = "yellow";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(hx - 15, hy - 15); ctx.lineTo(hx + 15, hy + 15);
        ctx.moveTo(hx + 15, hy - 15); ctx.lineTo(hx - 15, hy + 15);
        ctx.stroke();
    }
}

init();