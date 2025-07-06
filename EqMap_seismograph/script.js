// マップの初期設定
var map = L.map('map', {
    zoomSnap: 0,
    center: [37.575, 137.984],
    zoom: 5.6,
    minZoom: 4,
    preferCanvas: false
});

// Paneの設定
map.createPane("pane_map").style.zIndex = 1;

// ベースマップの定義
var baseMap = {
    "地理院地図 標準": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
        attribution: '国土地理院',
        pane: "pane_map"
    }),
    "地理院地図 淡色": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
        attribution: '国土地理院',
        pane: "pane_map"
    }),
    "地理院地図 白地図": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png', {
        attribution: '国土地理院',
        pane: "pane_map"
    }),
    "Google 標準地図": L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps',
        pane: "pane_map"
    }),
    "Google 衛星": L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps',
        pane: "pane_map"
    }),
    "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        pane: "pane_map"
    }),
    "ESRI World Imagery": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Esri',
        pane: "pane_map"
    }),
    "MIERUNE Dark": L.tileLayer('https://tile.mierune.co.jp/mierune_mono/{z}/{x}/{y}@2x.png', {
        attribution: 'MIERUNE',
        pane: "pane_map"
    })
};

// デフォルトのベースマップをマップに追加
baseMap["地理院地図 標準"].addTo(map);

// レイヤーコントロールを作成し、必ず変数に格納します
var layerControl = L.control.layers(baseMap, null, {
    position: 'topright',
    collapsed: false
}).addTo(map);

// ズームコントロールの位置を調整
try {
    map.zoomControl.setPosition('topright');
} catch (error) {
    console.error('ズームコントロールの設定エラー:', error);
}

// --- データ表示ロジック ---

// 各種定義
const affiColors = { '気象庁': '#ff0000', '防災科学技術研究所': '#0000ff', '地方公共団体': '#00ff00', 'SNET': '#26bdf2', 'DONET': '#624de1', 'SAGAMI': '#32cd32', 'NNET1': '#f1c232', 'LANDPORT': '#dea683' };
const cableColors = { 'RT_SNET': '#000000', 'RT_DONET': '#000000', 'RT_SAGAMI': '#000000', 'RT_NNET1': '#000000' };
const dataSources = [ { url: 'stations.json', type: 'stations', label: '陸上地震計' }, { url: './data/st_snet.json', type: 'SNET', label: 'S-net観測点' }, { url: './data/st_donet.json', type: 'DONET', label: 'DONET観測点' }, { url: './data/st_sagami.json', type: 'SAGAMI', label: '相模湾観測点' }, { url: './data/st_nnet1.json', type: 'NNET1', label: 'N-net1観測点' }, { url: './data/landport.json', type: 'LANDPORT', label: '陸上局' }, { url: './data/rt_snet.json', type: 'RT_SNET', label: 'S-netケーブル' }, { url: './data/rt_donet.json', type: 'RT_DONET', label: 'DONETケーブル' }, { url: './data/rt_sagami.json', type: 'RT_SAGAMI', label: '相模湾ケーブル' }, { url: './data/rt_nnet1.json', type: 'RT_NNET1', label: 'N-net1ケーブル' } ];

/**
 * ★★★ さらに改良されたデータ抽出関数 ★★★
 * テキストの中から最初の [...] または {...} のデータブロックを正確に抜き出します。
 * @param {string} text - ファイルから読み込んだ生のテキスト
 * @returns {object} - 読み取ったデータオブジェクト
 */
function extractDataFromJs(text) {
    try {
        // 純粋なJSONなら、ここで成功する
        return JSON.parse(text);
    } catch (e) {
        // JS変数や他のコードが含まれる場合
        const startIndex = text.search(/[\{\[]/);
        if (startIndex === -1) {
            throw new Error("データ開始文字 '{' または '[' が見つかりません。");
        }

        const openChar = text[startIndex];
        const closeChar = (openChar === '{') ? '}' : ']';
        
        let depth = 1;
        let endIndex = -1;

        // 開始文字の次からループして、対応する閉じ括弧を探す
        for (let i = startIndex + 1; i < text.length; i++) {
            const char = text[i];
            if (char === openChar) {
                depth++;
            } else if (char === closeChar) {
                depth--;
            }

            if (depth === 0) {
                endIndex = i;
                break; // 対応する閉じ括弧が見つかったのでループ終了
            }
        }
        
        if (endIndex === -1) {
            throw new Error(`対応する閉じ文字 '${closeChar}' が見つかりません。`);
        }

        const dataString = text.substring(startIndex, endIndex + 1);
        return JSON.parse(dataString);
    }
}


// データを非同期で読み込み、レイヤーを作成する関数
async function createLayersFromData() {
    for (const source of dataSources) {
        try {
            const response = await fetch(source.url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.text();

            // 改良された抽出関数でデータを安全に取得
            const data = extractDataFromJs(rawData);

            let layer;

            // GeoJSONデータ（ケーブルなど）
            if (Array.isArray(data) && data[0]?.type === "FeatureCollection") {
                layer = L.geoJSON(data, {
                    style: (feature) => ({
                        color: cableColors[source.type] || '#000000',
                        weight: 3,
                        opacity: 0.7
                    }),
                    onEachFeature: (feature, layer) => {
                        layer.bindPopup(`<b>${feature.properties.node || source.label}</b>`);
                    }
                });
            }
            // 観測点データ
            else {
                const markers = L.layerGroup();
                data.forEach(station => {
                    if (station.lat && station.lon) {
                        const color = affiColors[station.affi || source.type] || '#999999';
                        const marker = L.circleMarker([station.lat, station.lon], {
                            radius: 6,
                            fillColor: color,
                            color: '#000',
                            weight: 1,
                            opacity: 1,
                            fillOpacity: 0.8
                        });
                        marker.bindPopup(`<b>${station.name}</b><br>機関: ${station.affi || source.type}`);
                        markers.addLayer(marker);
                    }
                });
                layer = markers;
            }

            // 作成したレイヤーを地図とコントロールに追加
            if (layer) {
                layerControl.addOverlay(layer, source.label);
                layer.addTo(map);
            }

        } catch (error) {
            console.error(`'${source.label}' の読み込みエラー:`, error);
        }
    }
}

// 実行
createLayersFromData();