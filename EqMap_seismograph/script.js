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
    "地理院地図 標準": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', { attribution: '国土地理院', pane: "pane_map" }),
    "地理院地図 淡色": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { attribution: '国土地理院', pane: "pane_map" }),
    "地理院地図 白地図": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png', { attribution: '国土地理院', pane: "pane_map" }),
    "Google 標準地図": L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { attribution: 'Google Maps', pane: "pane_map" }),
    "Google 衛星": L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', { attribution: 'Google Maps', pane: "pane_map" }),
    "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors', pane: "pane_map" }),
    "ESRI World Imagery": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri', pane: "pane_map" }),
    "MIERUNE Dark": L.tileLayer('https://tile.mierune.co.jp/mierune_mono/{z}/{x}/{y}@2x.png', { attribution: 'MIERUNE', pane: "pane_map" })
};

// デフォルトのベースマップをマップに追加
baseMap["地理院地図 標準"].addTo(map);

// レイヤーコントロールを作成
var layerControl = L.control.layers(baseMap, null, { position: 'topright', collapsed: false }).addTo(map);

// ズームコントロールの位置を調整
try { map.zoomControl.setPosition('topright'); } catch (error) { console.error('ズームコントロールの設定エラー:', error); }

// --- データ表示ロジック ---

// 各種定義
const affiColors = { '気象庁': '#ff0000', '防災科学技術研究所': '#0000ff', '地方公共団体': '#00ff00', 'SNET': '#26bdf2', 'DONET': '#624de1', 'SAGAMI': '#ee7800', 'NNET1': '#f1c232', 'LANDPORT': '#dea683' };
const cableColors = { 'RT_SNET': '#000000', 'RT_DONET': '#000000', 'RT_SAGAMI': '#000000', 'RT_NNET1': '#000000' };
const dataSources = [
    { url: 'stations.json', type: 'stations', label: '陸上地震計' },
    { url: './data/st_snet.js', type: 'SNET', label: 'S-net観測点' },
    { url: './data/st_donet.js', type: 'DONET', label: 'DONET観測点' },
    { url: './data/st_sagami.js', type: 'SAGAMI', label: '相模湾観測点' },
    { url: './data/st_nnet1.js', type: 'NNET1', label: 'N-net1観測点' },
    { url: './data/landport.js', type: 'LANDPORT', label: '陸上局' },
    { url: './data/rt_snet.js', type: 'RT_SNET', label: 'S-netケーブル' },
    { url: './data/rt_donet.js', type: 'RT_DONET', label: 'DONETケーブル' },
    { url: './data/rt_sagami.js', type: 'RT_SAGAMI', label: '相模湾ケーブル' },
    { url: './data/rt_nnet1.js', type: 'RT_NNET1', label: 'N-net1ケーブル' }
];

// テキストから最初のデータブロックを抽出する関数
function extractDataFromJs(text) {
    try { return JSON.parse(text); } catch (e) {
        const startIndex = text.search(/[\{\[]/);
        if (startIndex === -1) throw new Error("データ開始文字 '{' または '[' が見つかりません。");
        const openChar = text[startIndex];
        const closeChar = (openChar === '{') ? '}' : ']';
        let depth = 1, endIndex = -1;
        for (let i = startIndex + 1; i < text.length; i++) {
            const char = text[i];
            if (char === openChar) depth++;
            else if (char === closeChar) depth--;
            if (depth === 0) { endIndex = i; break; }
        }
        if (endIndex === -1) throw new Error(`対応する閉じ文字 '${closeChar}' が見つかりません。`);
        return JSON.parse(text.substring(startIndex, endIndex + 1));
    }
}

// データを非同期で読み込み、レイヤーを作成する関数
async function createLayersFromData() {
    // ★★★ ネットワークごとの大きな親グループを作成 ★★★
    const networkGroups = {
        SNET: L.layerGroup(),
        DONET: L.layerGroup(),
        SAGAMI: L.layerGroup(),
        NNET1: L.layerGroup(),
        OTHERS: L.layerGroup() // その他のグループ
    };

    for (const source of dataSources) {
        try {
            const response = await fetch(source.url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.text();
            let layer;

            // 陸上局ファイル(複数のデータを含む)のための特別処理
            if (source.type === 'LANDPORT') {
                eval(rawData); 
                const landStationMap = { 'snet_landstation': 'SNET', 'donet_landstation': 'DONET', 'sagami_landstation': 'SAGAMI', 'nnet_landstation': 'NNET1' };
                for (const [varName, networkType] of Object.entries(landStationMap)) {
                    if (typeof window[varName] !== 'undefined') {
                        const landStationLayer = L.geoJSON(window[varName], {
                            pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 6, fillColor: affiColors[networkType] || affiColors.LANDPORT, fillOpacity: 0.8, weight: 0 }),
                            onEachFeature: (feature, layer) => {
                                const props = feature.properties;
                                const code = props.id || props.station_cd;
                                let popupContent = `<b>${props.station_name}</b>`;
                                if (code) popupContent += `<br>観測点コード: ${code}`;
                                popupContent += `<br>機関: 陸上局 (${networkType})`;
                                layer.bindPopup(popupContent);
                            }
                        });
                        // ★★★ 作成した陸上局レイヤーを、対応する親グループに追加 ★★★
                        if (networkGroups[networkType]) {
                            networkGroups[networkType].addLayer(landStationLayer);
                        }
                    }
                }
                continue; // このファイルの処理は完了したので、次のループへ
            }

            // DONETケーブルファイル(複数のデータを含む)のための特別処理
            if (source.type === 'RT_DONET') {
                eval(rawData);
                const varNames = ['donet1_bb', 'donet2_bb', 'donet_KMA01', 'donet_KMA02', 'donet_KMA03', 'donet_KMA04', 'donet_KMB05', 'donet_KMB06', 'donet_KMB07', 'donet_KMB08', 'donet_KMC09', 'donet_KMC10', 'donet_KMC11', 'donet_KMC12', 'donet_KMD13', 'donet_KMD14', 'donet_KMD15', 'donet_KMD16', 'donet_KME17', 'donet_KME18', 'donet_KME19', 'donet_KME20', 'donet_KME22', 'donet_KM_BU_A', 'donet_KM_BU_B', 'donet_KM_BU_C', 'donet_KM_BU_D', 'donet_KM_BU_E', 'donet_MRA01', 'donet_MRA02', 'donet_MRA03', 'donet_MRA04', 'donet_MRB05', 'donet_MRB06', 'donet_MRB07', 'donet_MRB08', 'donet_MRC09', 'donet_MRC10', 'donet_MRC11', 'donet_MRC12', 'donet_MRD13', 'donet_MRD14', 'donet_MRD15', 'donet_MRD16', 'donet_MRD17', 'donet_MRE18', 'donet_MRE19', 'donet_MRE20', 'donet_MRE21', 'donet_MRF22', 'donet_MRF23', 'donet_MRF24', 'donet_MRF25', 'donet_MRG26', 'donet_MRG27', 'donet_MRG28', 'donet_MRG29', 'donet_MR_BU_2A', 'donet_MR_BU_2B', 'donet_MR_BU_2C', 'donet_MR_BU_2D', 'donet_MR_BU_2E', 'donet_MR_BU_2F', 'donet_MR_BU_2G'];
                varNames.forEach(name => {
                    if (typeof window[name] !== 'undefined') {
                        const cableLayer = L.geoJSON(window[name], { style: { color: cableColors[source.type] || '#000000', weight: 3, opacity: 0.7 } });
                        // ★★★ DONETケーブルをDONET親グループに追加 ★★★
                        networkGroups.DONET.addLayer(cableLayer);
                    }
                });
                continue; // このファイルの処理は完了したので、次のループへ
            }

            // その他の単一データファイルの処理
            const data = extractDataFromJs(rawData);
            if (Array.isArray(data) && data[0]?.type === "FeatureCollection") {
                layer = L.geoJSON(data, {
                    style: (feature) => ({ color: cableColors[source.type] || '#000000', weight: 3, opacity: 0.7 }),
                    pointToLayer: (feature, latlng) => L.circleMarker(latlng, { radius: 6, fillColor: affiColors[source.type] || '#999999', fillOpacity: 0.8, weight: 0 }),
                    onEachFeature: (feature, layer) => {
                       const props = feature.properties;
                       const name = props.name || props.station_name || props.node || source.label;
                       const code = props.id || props.station_cd;
                       let popupContent = `<b>${name}</b>`;
                       if (feature.geometry.type === 'Point' && code) popupContent += `<br>観測点コード: ${code}`;
                       layer.bindPopup(popupContent);
                    }
                });
            } else {
                const markers = L.layerGroup();
                data.forEach(station => {
                    if (station.lat && station.lon) {
                        const color = affiColors[station.affi || source.type] || '#999999';
                        const markerOptions = { radius: 6, fillColor: color, fillOpacity: 0.8, weight: 0 };
                        if (source.type === 'stations') {
                            markerOptions.weight = 1;
                            markerOptions.color = '#000';
                        }
                        const marker = L.circleMarker([station.lat, station.lon], markerOptions);
                        const code = station.id || station.station_cd || station.code;
                        let popupContent = `<b>${station.name}</b>`;
                        if (code) popupContent += `<br>観測点コード: ${code}`;
                        popupContent += `<br>機関: ${station.affi || source.type}`;
                        marker.bindPopup(popupContent);
                        markers.addLayer(marker);
                    }
                });
                layer = markers;
            }

            // ★★★ 作成したレイヤーを、タイプに応じて適切な親グループに追加 ★★★
            if (layer) {
                const type = source.type.replace('RT_', ''); // 'RT_SNET' を 'SNET' に統一
                if (networkGroups[type]) {
                    networkGroups[type].addLayer(layer);
                } else {
                    networkGroups.OTHERS.addLayer(layer); // 該当がなければ「その他」へ
                }
            }

        } catch (error) {
            console.error(`'${source.label}' の読み込みエラー:`, error);
        }
    }

    // ★★★ 最後に、ネットワークごとの親グループを地図とレイヤーコントロールに追加 ★★★
    for (const group of Object.values(networkGroups)) {
        group.addTo(map); // 全グループをデフォルトで表示
    }
    layerControl.addOverlay(networkGroups.SNET, "S-net");
    layerControl.addOverlay(networkGroups.DONET, "DONET");
    layerControl.addOverlay(networkGroups.SAGAMI, "相模湾");
    layerControl.addOverlay(networkGroups.NNET1, "N-net");
    layerControl.addOverlay(networkGroups.OTHERS, "地上局");
}

// 実行
createLayersFromData();