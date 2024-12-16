const map = L.map('map').setView([35.6762, 139.6503], 5);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const waveColors = {
    '0.00-0.50': '#0000FF',
    '0.51-1.00': '#00FFFF',
    '1.01-1.50': '#00FF00',
    '1.51-2.00': '#80FF00',
    '2.01-3.00': '#FFFF00',
    '3.01-4.00': '#FFA500',
    '4.01-6.00': '#FF4500',
    '6.01-8.00': '#FF0000',
    '8.01-10.00': '#800000',
    '10.01+': '#000000'
};

// 凡例の追加
const legend = L.control({position: 'bottomright'});
legend.onAdd = function(map) {
    const div = L.DomUtil.create('div', 'legend');
    div.innerHTML += '<h4>波高 (m)</h4>';
    for (let range in waveColors) {
        div.innerHTML +=
            '<i style="background:' + waveColors[range] + '"></i> ' +
            range + 'm<br>';
    }
    return div;
};
legend.addTo(map);

// マーカーを格納する配列
let markers = [];

// マーカーをクリアする関数
function clearMarkers() {
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
}

// データを更新する関数
function updateWaveData() {
    const lastUpdateElement = document.getElementById('lastUpdate');
    lastUpdateElement.textContent = '更新中...';

    fetch('get-wave-data.php')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(result => {
            if (result.status !== 'success' || !result.data) {
                throw new Error('データの取得に失敗しました');
            }

            const points = result.data;
            
            clearMarkers();
            
            if (points.length === 0) {
                lastUpdateElement.textContent = '波高データが見つかりませんでした';
                return;
            }

            points.forEach(point => {
                const { lat, lon, name, waveHeight } = point;

                let color = '#0000FF'; // デフォルト色
                if (waveHeight > 10.01) color = '#000000';
                else if (waveHeight > 8.01) color = '#800000';
                else if (waveHeight > 6.01) color = '#FF0000';
                else if (waveHeight > 4.01) color = '#FF4500';
                else if (waveHeight > 3.01) color = '#FFA500';
                else if (waveHeight > 2.01) color = '#FFFF00';
                else if (waveHeight > 1.51) color = '#80FF00';
                else if (waveHeight > 1.01) color = '#00FF00';
                else if (waveHeight > 0.51) color = '#00FFFF';

                const marker = L.circleMarker([lat, lon], {
                    radius: 8,
                    fillColor: color,
                    color: '#000',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                }).addTo(map)
                .bindPopup(`${name}<br>波高: ${waveHeight}m`);
                
                markers.push(marker);
            });

            // 更新時刻を表示
            const now = new Date();
            const timeString = now.toLocaleString('ja-JP');
            lastUpdateElement.textContent = `最終更新: ${timeString}`;
        })
        .catch(error => {
            console.error('Error:', error);
            lastUpdateElement.textContent = `エラーが発生しました: ${error.message}`;
            setTimeout(updateWaveData, 60000); // エラー時は1分後に再試行
        });
}

// 初回データ取得
updateWaveData();

// 5分ごとにデータを更新
setInterval(updateWaveData, 5 * 60 * 1000);
