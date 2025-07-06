let map;
let currentGeoJson;

// 警報種別による色の定義
const warningColors = {
    special: '#000000',
    warning: '#ff0000',
    advisory: '#ffff00',
    none: '#ffffff'
};

// 地図の初期化
function initMap() {
    map = L.map('map').setView([38.0, 137.0], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
}

// JMAのデータを取得
async function fetchWarningData() {
    try {
        const response = await fetch('https://www.jma.go.jp/bosai/warning/data/warning/map.json');
        return await response.json();
    } catch (error) {
        console.error('警報データの取得に失敗しました:', error);
        return null;
    }
}

// 地域の警報レベルを判定
function getWarningLevel(warnings) {
    if (!Array.isArray(warnings)) return 'none';
    if (warnings.some(w => w.includes('特別警報'))) return 'special';
    if (warnings.some(w => w.includes('警報'))) return 'warning';
    if (warnings.some(w => w.includes('注意報'))) return 'advisory';
    return 'none';
}

// GeoJSONレイヤーのスタイル設定
function style(feature) {
    const warnings = feature.properties.warnings || [];
    const level = getWarningLevel(warnings);
    console.log('地域:', feature.properties.name, '警報レベル:', level);
    return {
        fillColor: warningColors[level],
        weight: 1,
        opacity: 1,
        color: '#666',
        fillOpacity: 0.7
    };
}

// 表示モードの切り替え処理
document.getElementById('displayMode').addEventListener('change', async (e) => {
    const mode = e.target.value;
    await updateMap(mode);
});

// 更新ボタンの処理
document.getElementById('refresh').addEventListener('click', async () => {
    const mode = document.getElementById('displayMode').value;
    await updateMap(mode);
});

// GeoJSONのパスを変更
const GEOJSON_PATHS = {
    prefecture: './AreaForecastLocalM_prefecture_GIS_20190125_01.geojson',
    city: './AreaInformationCity_weather_GIS_20230517_01.geojson'
};

// 地図の更新
async function updateMap(mode) {
    const warningData = await fetchWarningData();
    if (!warningData) return;

    if (currentGeoJson) {
        map.removeLayer(currentGeoJson);
    }

    try {
        const response = await fetch(GEOJSON_PATHS[mode]);
        const geoData = await response.json();

        // GeoJSONデータと警報データの結合
        geoData.features = geoData.features.map(feature => {
            // GeoJSONの地域コードを取得
            const code = feature.properties.code;
            const areaWarnings = warningData[code] || [];
            
            // 警報情報を地図データに追加
            feature.properties.warnings = Array.isArray(areaWarnings) ? areaWarnings : [];
            return feature;
        });

        currentGeoJson = L.geoJSON(geoData, {
            style: style,
            onEachFeature: (feature, layer) => {
                const warnings = feature.properties.warnings;
                const name = feature.properties.name;
                layer.bindPopup(`
                    <h3>${name}</h3>
                    <p>警報・注意報: ${warnings.length ? warnings.join(', ') : 'なし'}</p>
                `);

                // マウスオーバー時のハイライト
                layer.on({
                    mouseover: (e) => {
                        const layer = e.target;
                        layer.setStyle({
                            weight: 3,
                            fillOpacity: 0.9
                        });
                    },
                    mouseout: (e) => {
                        currentGeoJson.resetStyle(e.target);
                    }
                });
            }
        }).addTo(map);

        // マップの表示範囲を調整
        map.fitBounds(currentGeoJson.getBounds());

    } catch (error) {
        console.error('地図データの読み込みに失敗:', error);
    }
}

// 初期化
initMap();
updateMap('prefecture');
