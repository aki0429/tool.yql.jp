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

    // 2. 地図の初期化
    const map = L.map('map').setView([lat, lon], zoom);
    
    // 都道府県の境界線を表示
    try {
        const lineResponse = await fetch('prefectures.geojson');
        const lineData = await lineResponse.json();
        L.geoJSON(lineData, {
            style: { color: "#464646ff", weight: 0.9, opacity: 0.7, fill: false }
        }).addTo(map);
    } catch (error) {
        console.error('prefectures.geojsonの読み込みに失敗しました:', error);
    }
    
    // 3. WBGTの値に応じてスタイル情報を返す関数
    const getWbgtInfo = (wbgt) => {
        const value = parseFloat(wbgt);
        if (isNaN(value)) {
            return { level: 0, className: '', label: 'データなし' };
        }
        if (value < 25) {
            return { level: 1, className: 'wbgt-level-1', label: '注意' };
        } else if (value < 28) {
            return { level: 2, className: 'wbgt-level-2', label: '警戒' };
        } else if (value < 31) {
            return { level: 3, className: 'wbgt-level-3', label: '厳重警戒' };
        } else {
            return { level: 4, className: 'wbgt-level-4', label: '危険' };
        }
    };
    
    // 4. WBGT予測・実況値データを取得してマーカーをプロット
    try {
        const response = await fetch('get_data.php');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const jsonData = await response.json();
        
        // jsonDataの構造をコンソールに出力して確認する（デバッグに非常に便利です）
        console.log(jsonData); 

        // ★★★ 修正点：実況(sokuhou)と予測(yosoku)の配列を結合する
        const pointsArray = [...jsonData.sokuhou, ...jsonData.yosoku];

        // "pointsArray" 配列をループしてマーカーを作成
        pointsArray.forEach(point => {
            // (これ以降のコードは、おそらくそのままで動作します)
            if (point.wbgt && point.lat && point.lon) {
                // ...マーカー作成処理...
            }
        });

    } catch (error) {
        console.error('WBGTデータの処理に失敗しました:', error);
        // ...
    }

    // 5. URLハッシュを更新するイベントリスナー
    const updateUrlHash = () => {
        const center = map.getCenter();
        const currentZoom = map.getZoom();
        const currentLat = center.lat.toFixed(5);
        const currentLon = center.lng.toFixed(5);
        location.replace(`#${currentZoom}/${currentLat}/${currentLon}`);
    };

    map.on('moveend', updateUrlHash);
    map.on('zoomend', updateUrlHash);
}

// 処理を実行
main();