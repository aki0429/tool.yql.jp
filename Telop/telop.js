// P2P地震情報モニタリングシステム
let lastEarthquakeId = null;
let ws;
let isConnecting = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5秒

const mainAlert = document.getElementById('main-alert');
const eqDetails = document.getElementById('eq-details');
const intensityInfo = document.getElementById('intensity-info');
const endAlert = document.getElementById('end-alert');
const alertSound = document.getElementById('alert-sound');

let stations = {};

console.log("地震情報を取得中...");

// WebSocket接続を確立する関数
function connectWebSocket() {
    if (isConnecting) return;
    isConnecting = true;

    ws = new WebSocket('wss://api-realtime-sandbox.p2pquake.net/v2/ws');

    ws.onopen = () => {
        console.log('WebSocket接続が確立されました');
        isConnecting = false;
        reconnectAttempts = 0;
        playSound(); // 接続確認音
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // 地震情報（551）のみを処理
        if (data.code === 551) {
            console.log('地震情報を受信しました:', data);
            showEarthquakeInfo(data);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket接続が切断されました');
        isConnecting = false;
        
        // 再接続を試みる
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`再接続を試みます... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
            setTimeout(connectWebSocket, RECONNECT_DELAY);
        } else {
            console.error('最大再接続試行回数に達しました');
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocketエラー:', error);
        isConnecting = false;
    };
}

// 震度情報を整形する関数
function formatIntensityInfo(points) {
    let intensityText = '';
    const intensityGroups = {};
    
    // 震度の変換関数
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

    // Group areas by intensity and remove duplicates
    points.forEach(point => {
        const intensity = convertIntensity(point.scale);
        const city = stations[point.addr] || point.addr; // 市町村名に変換
        if (!intensityGroups[intensity]) {
            intensityGroups[intensity] = [];
        }
        intensityGroups[intensity].push(city);
    });
    
    // Sort intensities in descending order
    const intensityOrder = ["7", "6強", "6弱", "5強", "5弱", "4", "3", "2", "1"];
    
    // Format each intensity group
    intensityOrder.forEach(intensity => {
        if (intensityGroups[intensity] && intensityGroups[intensity].length > 0) {
            const areas = intensityGroups[intensity];
            let line = `　　<span class="intensity-label">震度${intensity}</span>　`;
            let currentLineLength = line.length;
            areas.forEach(city => {
                if (currentLineLength + city.length + 1 > 65) {
                    intensityText += `${line.trim()}\n`;
                    line = `　　　　${city}　`;
                    currentLineLength = line.length;
                } else {
                    line += `${city}　`;
                    currentLineLength += city.length + 1;
                }
            });
            intensityText += `${line.trim()}\n`;
        }
    });
    
    return intensityText.trim().split('\n');
}

// 地震情報を表示する関数
async function showEarthquakeInfo(data) {
    try {
        // 音を鳴らす
        playSound();

        // 1. 最初の表示（3秒間点滅）
        mainAlert.classList.remove('hidden');
        await sleep(3000);
        mainAlert.classList.add('hidden');

        // 2. 各地の震度情報を表示（8秒間）
        const intensityInfoText = formatIntensityInfo(data.points);
        
        // 震度データがない場合はスキップ
        if (intensityInfoText.length === 0) {
            return; // 何も表示しない
        }
        
        let index = 0;
        while (index < intensityInfoText.length) {
            const linesToShow = intensityInfoText.slice(index, index + 2).join('<br>'); // 2行分の震度情報を結合
            intensityInfo.innerHTML = linesToShow; // 結合した震度情報を表示
            intensityInfo.style.textAlign = 'left';
            intensityInfo.style.margin = '0 auto';
            intensityInfo.style.width = 'fit-content';
            intensityInfo.classList.remove('hidden');
            await sleep(5000);
            intensityInfo.classList.add('hidden');
            index += 2; // 次の震度情報に進む
        }
        // 3. 終了表示（3秒間）
        endAlert.classList.remove('hidden');
        await sleep(3000);
        endAlert.classList.add('hidden');
    } catch (error) {
        console.error('地震情報の表示中にエラーが発生しました:', error);
    }
}

// ユーティリティ関数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function playSound() {
    const audio = new Audio('nc284095_ピーン・起動音、スタート、アイキャッチ_pibell.wav');
    document.addEventListener('click', () => {
        audio.play().catch(error => console.error('音声の再生に失敗しました:', error));
    }, { once: true });
}

// ページ読み込み時にWebSocket接続を開始
window.addEventListener('load', () => {
    // 非同期関数を定義して実行
    (async () => {
        // 市町村データの読み込み
        stations = await fetch('stations.json').then(response => response.json());
        
        connectWebSocket();
    })();
});
