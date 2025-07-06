// グローバルスコープに変数を定義
let map;
let weatherForecastLayer;
let prefecturesLayer;
const minZoomForPins = 7; // このズームレベル以上でピンを表示

const JMA_TARGET_TIMES_URL = 'https://www.jma.go.jp/bosai/jmatile/data/wdist/targetTimes.json';
const PREFECTURES_GEOJSON_PATH = 'prefectures.geojson'; // GeoJSONファイルへのパス

// エラーメッセージを表示するコンテナを作成
const errorContainer = document.createElement('div');
errorContainer.className = 'error-message-container';
document.body.appendChild(errorContainer);

/**
 * エラーメッセージを画面に表示する関数
 * @param {string} message 表示するメッセージ
 * @param {string} type 'error' または 'geojson-error'
 */
function displayErrorMessage(message, type = 'error') {
    const errorDiv = document.createElement('div');
    errorDiv.textContent = message;
    if (type === 'geojson-error') {
        errorDiv.className = 'error-message-geojson';
    } else {
        errorDiv.className = 'error-message';
    }
    errorContainer.appendChild(errorDiv);
    setTimeout(() => {
        errorDiv.remove();
    }, 7000);
}

/**
 * 地図を初期化する関数
 */
function initializeMap() {
    map = L.map('map', {
        center: [37.0, 138.0], // 日本全体が概ね入る中心座標
        zoom: 5, // 初期ズームレベル
        zoomControl: true // ズームコントロールを表示
    });

    // ★★★ 背景地図レイヤーをCSSフィルター適用対象のタイルに変更 ★★★
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
        minZoom: 3,
        className: 'custom-dark-tile' // ★ CSSフィルターを適用するためのクラス名
    }).addTo(map);

    // ズームイベントリスナーを設定
    map.on('zoomend', togglePinsVisibility);
}

/**
 * 気象庁の天気分布予報タイルを読み込んで表示する関数
 */
async function loadWeatherForecast() {
    try {
        const response = await fetch(JMA_TARGET_TIMES_URL);
        if (!response.ok) {
            throw new Error(`気象庁時刻情報 (targetTimes.json) の取得に失敗: ${response.status}`);
        }
        const targetTimes = await response.json();

        // 最新の有効な予報時刻を選択するロジック
        let latestForecast = targetTimes.find(time => time.tense === 'latest' && time.basetime && time.validtime);
        if (!latestForecast) {
            // 'latest' がない場合、'past' ではなく、basetimeとvalidtimeが存在する最初のものを探す
            latestForecast = targetTimes.filter(time => time.tense !== 'past' && time.basetime && time.validtime)[0];
        }
        if (!latestForecast) {
            // それでも見つからない場合、basetimeとvalidtimeが存在する最後のエントリを使用
            const validEntries = targetTimes.filter(time => time.basetime && time.validtime);
            if (validEntries.length > 0) {
                latestForecast = validEntries[validEntries.length - 1];
            }
        }

        if (latestForecast && latestForecast.basetime && latestForecast.validtime) {
            const { basetime, validtime } = latestForecast;
            const tileUrlTemplate = `https://www.jma.go.jp/bosai/jmatile/data/wdist/${basetime}/${validtime}/surf/wm/{z}/{x}/{y}.png`;
            
            console.log("気象庁タイルURL:", tileUrlTemplate.replace('{z}/{x}/{y}.png', '...'));

            if (weatherForecastLayer) {
                map.removeLayer(weatherForecastLayer);
            }
            weatherForecastLayer = L.tileLayer(tileUrlTemplate, {
                attribution: '出典: 気象庁', // クレジット表示
                opacity: 0.9, 
                minZoom: 4,   // 気象庁タイルが表示される最小ズーム (要確認・調整)
                maxZoom: 11   // 気象庁タイルが表示される最大ズーム (要確認・調整)
            }).addTo(map);
        } else {
            console.error('利用可能な予報時刻を targetTimes.json から取得できませんでした。', targetTimes);
            displayErrorMessage('天気予報データの時刻情報が見つかりません。');
        }

    } catch (error) {
        console.error('天気分布予報の読み込み処理中にエラー:', error);
        displayErrorMessage(`天気予報データの読み込みに失敗: ${error.message}`);
    }
}

/**
 * 都道府県のピンデータをGeoJSONファイルから読み込んで表示する関数
 */
async function loadPrefecturesData() {
    try {
        const response = await fetch(PREFECTURES_GEOJSON_PATH);
        if (!response.ok) {
            throw new Error(`都道府県GeoJSON (${PREFECTURES_GEOJSON_PATH}) の取得に失敗: ${response.status}`);
        }
        const data = await response.json();

        prefecturesLayer = L.geoJSON(data, {
            pointToLayer: function (feature, latlng) {
                // ピン（マーカー）のスタイルをここでカスタマイズ可能
                return L.marker(latlng, {
                    // icon: customIcon // カスタムアイコンを使用する場合
                });
            },
            onEachFeature: function (feature, layer) {
                // GeoJSONのプロパティに 'name' があればポップアップとして表示
                if (feature.properties && feature.properties.name) {
                    layer.bindPopup(feature.properties.name);
                }
            }
        });
        // 初期表示のためにズームレベルをチェックしてレイヤーの表示/非表示を更新
        togglePinsVisibility();

    } catch (error) {
        console.error('都道府県GeoJSONの読み込み処理中にエラー:', error);
        displayErrorMessage(`都道府県データの読み込みに失敗: ${error.message}`, 'geojson-error');
    }
}

/**
 * ズームレベルに応じて都道府県ピンの表示/非表示を切り替える関数
 */
function togglePinsVisibility() {
    if (!map || !prefecturesLayer) return; // マップまたはレイヤーが未初期化の場合は何もしない

    if (map.getZoom() >= minZoomForPins) {
        if (!map.hasLayer(prefecturesLayer)) {
            map.addLayer(prefecturesLayer);
        }
    } else {
        if (map.hasLayer(prefecturesLayer)) {
            map.removeLayer(prefecturesLayer);
        }
    }
}

// DOMが読み込まれたら処理を開始
document.addEventListener('DOMContentLoaded', () => {
    initializeMap();
    loadWeatherForecast(); // 天気予報タイルの読み込み
    loadPrefecturesData(); // 都道府県ピンの読み込み
});
