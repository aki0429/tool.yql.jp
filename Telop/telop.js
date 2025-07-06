// P2P地震情報モニタリングシステム
let ws;
let isConnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

const eqDetails = document.getElementById('eq-details');
const intensityInfo = document.getElementById('intensity-info');

// 観測点コードと市町村名をマッピングするためのオブジェクト
let stationMap = {};

console.log("スクリプトを読み込みました。");

// WebSocket接続を確立する関数
function connectWebSocket() {
    if (isConnecting) return;
    isConnecting = true;

    console.log('WebSocket接続を開始します...');
    try {
        ws = new WebSocket('wss://api.p2pquake.net/v2/ws');

        const connectionTimeout = setTimeout(() => {
            if (ws && ws.readyState !== WebSocket.OPEN) {
                console.log('接続がタイムアウトしました。再接続を試みます...');
                ws.close();
            }
        }, 10000);

        ws.onopen = () => {
            console.log('WebSocket接続が確立されました');
            isConnecting = false;
            reconnectAttempts = 0;
            clearTimeout(connectionTimeout);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // 地震情報（コード551）のみを処理
                if (data.code === 551) {
                    console.log('地震情報を受信しました:', data);
                    showEarthquakeInfo(data);
                }
            } catch (error) {
                console.error('メッセージの処理中にエラーが発生しました:', error);
            }
        };

        ws.onclose = (event) => {
            console.log('WebSocket接続が切断されました');
            console.log('切断コード:', event.code);
            isConnecting = false;
            clearTimeout(connectionTimeout);
            
            if (event.code !== 1000 && event.code !== 1001) { // 計画的な切断でない場合のみ再接続
                if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
                    console.log(`再接続を試みます... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) - ${delay}ms後`);
                    setTimeout(connectWebSocket, delay);
                } else {
                    console.error('最大再接続試行回数に達しました');
                }
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocketエラー発生:', error);
            isConnecting = false;
        };
    } catch (error) {
        console.error('WebSocket接続の作成中にエラーが発生しました:', error);
        isConnecting = false;
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            setTimeout(connectWebSocket, 1000);
        }
    }
}

/**
 * P2PQuake APIから送られてくる津波の警戒レベルを日本語の文字列に変換します。
 * @param {string} level - APIからの津波警戒レベル ('None', 'Checking', 'No Tsunami'など)
 * @returns {string} 日本語の津波情報
 */
function getTsunamiText(level) {
    switch (level) {
        case "None":
            return "津波の心配はありません";
        case "Checking":
            return "津波については調査中です";
        case "No Tsunami":
            return "津波の心配はありません";
        case "Tsunami Warning":
            return "津波警報が発表されています";
        default:
            return "津波情報不明";
    }
}

/**
 * 震度スケールを日本の震度階級の文字列に変換します。
 * @param {number} scale - APIからの震度スケール (例: 45)
 * @returns {string} 震度階級の文字列 (例: "5弱")
 */
function convertIntensity(scale) {
    switch(scale) {
        case 10: return "1";
        case 20: return "2";
        case 30: return "3";
        case 40: return "4";
        case 45: return "5弱";
        case 50: return "5強";
        case 55: return "6弱";
        case 60: return "6強";
        case 70: return "7";
        default: return "不明";
    }
}

/**
 * 震度ごとの観測点情報をHTML文字列として整形します。
 * @param {Array} points - 地震情報の観測点データ
 * @returns {Array<string>} 震度レベルごとに整形されたHTML文字列の配列
 */
function formatIntensityData(points) {
    const intensityGroups = {};
    points.forEach(point => {
        const intensity = convertIntensity(point.scale);
        const cityName = stationMap[point.addr] ? stationMap[point.addr].name : point.addr;
        if (!intensityGroups[intensity]) intensityGroups[intensity] = [];
        intensityGroups[intensity].push(cityName);
    });
    
    const intensityOrder = ["7", "6強", "6弱", "5強", "5弱", "4", "3", "2", "1"];
    const formattedBlocks = [];
    
    intensityOrder.forEach(intensity => {
        const cities = intensityGroups[intensity];
        if (cities && cities.length > 0) {
            const prefix = `震度${intensity}　`;
            // white-space: pre のため、半角スペースでインデントを調整
            const padding = ' '.repeat(prefix.length * 2); // 全角文字幅を考慮
            let lines = [];
            let currentLine = prefix;
            
            cities.forEach((city, index) => {
                const separator = '　';
                if ((currentLine + city + separator).length > 30 && currentLine !== prefix) {
                    lines.push(currentLine);
                    currentLine = padding + city;
                } else {
                    currentLine += (index === 0 && currentLine === prefix ? '' : separator) + city;
                }
            });
            lines.push(currentLine);
            formattedBlocks.push(lines.join('<br>'));
        }
    });

    return formattedBlocks;
}

// 地震情報を表示する関数
async function showEarthquakeInfo(data) {
    try {
        // 1. 地震発生時刻を表示
        const now = new Date(data.time);
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        eqDetails.innerHTML = `${hours}時${minutes}分ごろ地震がありました`;
        eqDetails.classList.remove('hidden');
        await sleep(5000);

        // 2. 津波情報を表示
        const tsunamiText = getTsunamiText(data.earthquake.tsunami.level);
        eqDetails.innerHTML = `津波情報<br>${tsunamiText}`;
        await sleep(5000);
        
        // 3. 震源地と規模を表示
        const hypo = data.earthquake.hypocenter;
        const depth = hypo.depth === -1 ? "ごく浅い" : `${hypo.depth}km`;
        const magnitude = hypo.magnitude === -1 ? "不明" : hypo.magnitude.toFixed(1);
        eqDetails.innerHTML = `震源地は${hypo.name}<br>深さは${depth}　マグニチュードは${magnitude}`;
        await sleep(5000);
        eqDetails.classList.add('hidden');

        // 4. 各地の震度情報を表示
        const intensityBlocks = formatIntensityData(data.points);
        if (intensityBlocks.length > 0) {
            for (const block of intensityBlocks) {
                intensityInfo.innerHTML = block;
                intensityInfo.classList.remove('hidden');
                await sleep(5000);
            }
        }
        
    } catch (error) {
        console.error('地震情報の表示中にエラーが発生しました:', error);
    } finally {
        // 全ての表示が完了したら非表示にする
        eqDetails.classList.add('hidden');
        intensityInfo.classList.add('hidden');
    }
}

// ユーティリティ関数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ページ読み込み時の処理
window.addEventListener('load', () => {
    (async () => {
        try {
            // 市町村データの読み込みと整形
            const response = await fetch('stations.json');
            const stationsArray = await response.json();
            stationsArray.forEach(station => {
                stationMap[station.code] = {
                    name: station.city.name
                };
            });
            console.log('観測点データの準備が完了しました。');

            // WebSocket接続を開始
            connectWebSocket();
        } catch (error) {
            console.error('観測点データの読み込みまたは初期化中にエラーが発生しました:', error);
        }
    })();
});