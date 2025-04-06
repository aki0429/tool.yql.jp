document.addEventListener('DOMContentLoaded', function() {
    // 警報コードとその内容のマッピング
    const warningCodes = {
        '02': '暴風特別警報',
        '06': '大雨特別警報',
        '07': '大雪特別警報',
        '12': '大雨警報',
        '13': '洪水警報',
        '14': '大雪警報',
        '15': '暴風警報',
        '16': '波浪警報', 
        '19': '高潮警報',
        '21': '強風注意報',
        '22': '大雨注意報',
        '23': '大雪注意報',
        '24': '波浪注意報',
        '26': '洪水注意報'
    };

    // 地図の初期化
    const map = L.map('map').setView([36.5, 138], 5);
    
    // 国土地理院の白地図タイル
    L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/blank/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>'
    }).addTo(map);

    // マウスポインタの緯度経度を表示
    const coordsDiv = document.getElementById('coordinates');
    map.on('mousemove', function(e) {
        coordsDiv.innerHTML = `緯度: ${e.latlng.lat.toFixed(4)}, 経度: ${e.latlng.lng.toFixed(4)}`;
    });

    // 警報の深刻度に応じた色を返す関数
    function getWarningColor(warnings) {
        if (warnings.some(w => w.code && w.code.startsWith('0'))) return '#000000';  // 特別警報
        if (warnings.some(w => w.code && parseInt(w.code) >= 12 && parseInt(w.code) <= 19)) return '#ff0000';  // 警報
        if (warnings.some(w => w.code && parseInt(w.code) >= 20)) return '#ffff00';  // 注意報
        return '#ffffff';  // その他
    }

    // 警報情報を人間が読みやすい形式に変換する関数
    function formatWarningContent(warnings) {
        return warnings.map(w => {
            const code = warningCodes[w.code] || '不明';
            const status = w.status || '不明';
            return `${code}: ${status}`;
        }).join('<br>');
    }

    // 警報情報の取得と表示
    fetch('https://www.jma.go.jp/bosai/warning/data/warning/map.json')
        .then(response => response.json())
        .then(data => {
            data.forEach(region => {
                if (region.warnings && region.warnings.length > 0) {
                    const color = getWarningColor(region.warnings);
                    const content = formatWarningContent(region.warnings);
                    const popup = L.popup().setContent(content);
                    
                    L.circleMarker([region.lat, region.lon], {
                        radius: 8,
                        fillColor: color,
                        color: '#000',
                        weight: 1,
                        opacity: 1,
                        fillOpacity: 0.8
                    }).bindPopup(popup).addTo(map);
                }
            });
        })
        .catch(error => console.error('Error:', error));
});
