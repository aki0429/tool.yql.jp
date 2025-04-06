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
// ベースマップの定義
var baseMap = {
    // 国土地理院マップ
    "地理院地図 標準": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
        attribution: '国土地理院',
        pane: "pane_map"
    }).addTo(map), // デフォルト地図
    "地理院地図 淡色": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
        attribution: '国土地理院',
        pane: "pane_map"
    }),
    "地理院地図 白地図": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png', {
        attribution: '国土地理院',
        pane: "pane_map"
    }),
    
    // Googleマップ
    "Google 標準地図": L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps',
        pane: "pane_map"
    }),
    "Google 道路地図": L.tileLayer('https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps',
        pane: "pane_map"
    }),
    "Google 衛星": L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps',
        pane: "pane_map"
    }),
    "Google 地形図": L.tileLayer('https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}', {
        attribution: 'Google Maps',
        pane: "pane_map"
    }),
    
    // OpenStreetMap
    "OpenStreetMap": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        pane: "pane_map"
    }),
    "OpenStreetMap HOT": L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        pane: "pane_map"
    }),
    
    // 気象庁
    "気象庁": L.tileLayer('https://www.data.jma.go.jp/svd/eqdb/data/shindo/map/{z}/{x}/{y}.png', {
        attribution: '気象庁',
        pane: "pane_map"
    }),
    
    // ESRI
    "ESRI World Street": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Esri',
        pane: "pane_map"
    }),
    "ESRI World Imagery": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Esri',
        pane: "pane_map"
    }),
    
    // MIERUNE
    "MIERUNE Streets": L.tileLayer('https://tile.mierune.co.jp/mierune/{z}/{x}/{y}.png', {
        attribution: 'MIERUNE',
        pane: "pane_map"
    }),
    "MIERUNE Dark": L.tileLayer('https://tile.mierune.co.jp/mierune_mono/{z}/{x}/{y}@2x.png', {
        attribution: 'MIERUNE',
        pane: "pane_map"
    })
};

// デフォルトレイヤーを追加
baseMap["地理院地図 標準"].addTo(map);

// レイヤーコントロールを追加
L.control.layers(baseMap, null, {
    position: 'topright',
    collapsed: false
}).addTo(map);

try {
    // ズームコントロールの位置を調整
    map.zoomControl.setPosition('topright');
} catch (error) {
    console.error('ズームコントロールの設定エラー:', error);
}
// 機関ごとの色を定義
const affiColors = {
    '気象庁': '#ff0000',
    '防災科学技術研究所': '#0000ff',
    '地方公共団体': '#00ff00'
};

// データ読み込みとマーカー表示
fetch('stations.json')
    .then(response => {
        if (!response.ok) throw new Error('Network response was not ok');
        return response.json();
    })
    .then(stations => {
        stations.forEach(station => {
            const color = affiColors[station.affi] || '#999999';
            L.circleMarker([station.lat, station.lon], {
                radius: 6,
                fillColor: color,
                color: '#000',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            })
            .bindPopup(`<b>${station.name}</b><br>機関: ${station.affi}`)
            .addTo(map);
        });
    })
    .catch(error => console.error('データの読み込みエラー:', error));


// マーカータイプと色の定義
const seaFloorColors = {
    // 観測点（暖色系）
    'SNET': '#26bdf2',     // 赤橙
    'DONET': '#624de1',    // サーモンピンク
    'SAGAMI': '#32cd32',   // オレンジ
    'NNET1': '#f1c232',    // ライトピンク
    
    // ケーブル（寒色系）
    'RT_SNET': '#000000',  // シアン
    'RT_DONET': '#000000', // 青
    'RT_SAGAMI': '#000000',// ミディアムスレートブルー
    'RT_NNET1': '#000000', // ロイヤルブルー
    
    // 陸上局（無彩色）
    'LANDPORT': '#dea683'   // ダークグレー
};

const seaFloorDataSources = [
    { url: './data/st_snet.json', type: 'SNET', label: 'S-net観測点' },
    { url: './data/st_donet.json', type: 'DONET', label: 'DONET観測点' },
    { url: './data/st_sagami.json', type: 'SAGAMI', label: '相模湾観測点' },
    { url: './data/st_nnet1.json', type: 'NNET1', label: 'N-net1観測点' },
    { url: './data/rt_snet.json', type: 'RT_SNET', label: 'S-netケーブル' },
    { url: './data/rt_donet.json', type: 'RT_DONET', label: 'DONETケーブル' },
    { url: './data/rt_sagami.json', type: 'RT_SAGAMI', label: '相模湾ケーブル' },
    { url: './data/rt_nnet1.json', type: 'RT_NNET1', label: 'N-net1ケーブル' },
    { url: './data/landport.json', type: 'LANDPORT', label: '陸上局' }
];

async function fetchSeaFloorData() {
    const markerGroup = L.layerGroup();
    
    for (const source of seaFloorDataSources) {
        try {
            const response = await fetch(source.url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.text();
            
            const jsonMatch = rawData.match(/^var\s+\w+\s*=\s*(\[[\s\S]*\]);?$/);
            const data = JSON.parse(jsonMatch ? jsonMatch[1] : rawData);

            if (Array.isArray(data) && data[0]?.type === "FeatureCollection") {
                data[0].features.forEach(feature => {
                    const props = feature.properties;
                    const coords = feature.geometry.coordinates;
                    
                    if (coords && coords.length >= 2) {
                        const circle = L.circleMarker([coords[1], coords[0]], {
                            radius: 6,
                            fillColor: seaFloorColors[source.type],
                            color: '#000',
                            weight: 1,
                            opacity: 0.8,
                            fillOpacity: 0.6  // 透明度を上げて重なりを見やすく
                        });

                        circle.bindPopup(`
                            <strong>${props.name || props.id || '観測点'}</strong><br>
                            タイプ: ${source.label}<br>
                            緯度: ${coords[1]}<br>
                            経度: ${coords[0]}
                            ${props.depth ? '<br>深度: ' + props.depth + 'm' : ''}
                        `);

                        markerGroup.addLayer(circle);
                    }
                });
            } else {
                data.forEach(station => {
                    if (station.lat && station.lon) {
                        const circle = L.circleMarker([station.lat, station.lon], {
                            radius: 6,
                            fillColor: seaFloorColors[source.type],
                            color: '#000',
                            weight: 1,
                            opacity: 1,
                            fillOpacity: 0.8
                        });

                        circle.bindPopup(`
                            <strong>${station.name || '観測点'}</strong><br>
                            タイプ: ${source.label}<br>
                            緯度: ${station.lat}<br>
                            経度: ${station.lon}
                        `);

                        markerGroup.addLayer(circle);
                    }
                });
            }
        } catch (error) {
            console.error(`${source.label}データの読み込みエラー:`, error);
        }
    }
    
    return markerGroup;
}

// データ読み込みと地図表示
fetchSeaFloorData().then(markerGroup => {
    markerGroup.addTo(map);
    layerControl.addOverlay(markerGroup, '海底地震計');
}).catch(error => {
    console.error('データの読み込みエラー:', error);
});