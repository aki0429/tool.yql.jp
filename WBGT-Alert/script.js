// メインの処理を非同期関数として定義
async function main() {
    
    // 1. URLのハッシュから初期位置を決定する
    let zoom = 5;
    let lat = 36.2048;
    let lon = 138.2529;

    const hash = location.hash.substring(1); 
    if (hash) {
        const parts = hash.split('/');
        if (parts.length === 3) {
            const parsedZoom = parseInt(parts[0], 10);
            const parsedLat = parseFloat(parts[1]);
            const parsedLon = parseFloat(parts[2]);

            if (!isNaN(parsedZoom) && !isNaN(parsedLat) && !isNaN(parsedLon)) {
                zoom = parsedZoom;
                lat = parsedLat;
                lon = parsedLon;
            }
        }
    }

    // 2. 地図の初期化（タイルレイヤーの記述は削除）
    const map = L.map('map').setView([lat, lon], zoom);

    try {
        const lineResponse = await fetch('prefectures.geojson');
        const lineData = await lineResponse.json();
        L.geoJSON(lineData, {
            style: { color: "#7d7d7d", weight: 0.9, opacity: 0.7 }
        }).addTo(map);

        // 3. マーカー用のJSONファイルを3つ定義
        const level1File = 'pref_lat_lon.json';      // Zoom 8以上
        const level2File = 'pref_lat_lon2.json';     // Zoom 6-7
        const level3File = 'pref_lat_lon3.json';     // Zoom 5以下

        // 4. 3つのJSONファイルを読み込む
        const [level1Response, level2Response, level3Response] = await Promise.all([
            fetch(level1File),
            fetch(level2File),
            fetch(level3File)
        ]);
        const level1Data = await level1Response.json();
        const level2Data = await level2Response.json();
        const level3Data = await level3Response.json();

        // 5. マーカーを格納するレイヤーグループを3つ作成
        const level1Layer = L.layerGroup();
        const level2Layer = L.layerGroup();
        const level3Layer = L.layerGroup();
        const customIcon = L.divIcon({
            className: 'custom-div-icon', html: '◉', iconSize: [24, 24], iconAnchor: [12, 12]
        });

        // 6. 各レベルのマーカーを作成して各レイヤーに追加
        level1Data.forEach(point => {
            let tooltipDirection = 'right';
            let tooltipOffset = [10, 0];
            if (['神戸市', '大阪市', '京都市'].includes(point.pref_capital)) {
                tooltipDirection = 'left';
                tooltipOffset = [-10, 0];
            }
            L.marker([point.lat, point.lon], { icon: customIcon })
                .bindPopup(`<b>${point.pref_capital}</b><br>${point.pref_name}`)
                .bindTooltip(point.pref_capital, { permanent: true, direction: tooltipDirection, offset: tooltipOffset, className: 'custom-tooltip' })
                .addTo(level1Layer);
        });

        level2Data.forEach(point => {
            L.marker([point.lat, point.lon], { icon: customIcon })
                .bindPopup(`<b>${point.pref_capital}</b><br>${point.pref_name}`)
                .bindTooltip(point.pref_capital, { permanent: true, direction: 'right', offset: [10, 0], className: 'custom-tooltip' })
                .addTo(level2Layer);
        });

        level3Data.forEach(point => {
            L.marker([point.lat, point.lon], { icon: customIcon })
                .bindPopup(`<b>${point.pref_capital}</b><br>${point.pref_name}`)
                .bindTooltip(point.pref_capital, { permanent: true, direction: 'right', offset: [10, 0], className: 'custom-tooltip' })
                .addTo(level3Layer);
        });

        // 7. ズームレベルに応じてレイヤーを切り替える関数
        const updateLayers = () => {
            const currentZoom = map.getZoom();
            map.removeLayer(level1Layer); // 全て一旦削除
            map.removeLayer(level2Layer);
            map.removeLayer(level3Layer);

            if (currentZoom <= 5) {
                map.addLayer(level3Layer);
            } else if (currentZoom <= 7) {
                map.addLayer(level2Layer);
            } else {
                map.addLayer(level1Layer);
            }
        };
        
        // 8. URL更新とレイヤー更新のイベントリスナーを設定
        const updateUrlHash = () => {
            const center = map.getCenter();
            const currentZoom = map.getZoom();
            const currentLat = center.lat.toFixed(5);
            const currentLon = center.lng.toFixed(5);
            location.replace(`#${currentZoom}/${currentLat}/${currentLon}`);
        };

        map.on('moveend', updateUrlHash);
        map.on('zoomend', () => {
            updateUrlHash();
            updateLayers();
        });

        // 9. 初期表示のために一度実行
        updateLayers();

    } catch (error) {
        console.error('データの読み込みに失敗しました:', error);
        alert('地図データの読み込みに失敗しました。コンソールを確認してください。');
    }
}

// 処理を実行
main();