// 地図を初期化
const map = L.map('map', {
    center: [36.0, 138.0], // 初期表示の中心座標 [緯度, 経度]
    zoom: 5 // 初期のズームレベル
});

// 国土地理院の標準地図タイルを追加
L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
    attribution: "<a href='https://maps.gsi.go.jp/development/ichiran.html' target='_blank'>地理院タイル</a>"
}).addTo(map);

// 揺れのデータを表示するためのレイヤーグループを作成
// これにより、後でまとめてクリアしたり追加したりできる
let shinmonLayerGroup = L.layerGroup().addTo(map);

// WebSocketに接続してリアルタイムデータを取得
connectWebSocket();

function connectWebSocket() {
    // 強震モニタのWebSocketサーバー (有志により解析されたURL)
    const socket = new WebSocket('ws://www.kmoni.bosai.go.jp/websocket');

    socket.onopen = (event) => {
        console.log('WebSocketに接続しました。');
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type !== "psv") return; // 地震情報(psv)データでなければ処理を中断
        updateMap(data.points);
    };

    socket.onclose = (event) => {
        console.log('WebSocket接続が切れました。3秒後に再接続を試みます...');
        setTimeout(connectWebSocket, 3000);
    };
    
    socket.onerror = (error) => {
        console.error('WebSocketエラー:', error);
        socket.close();
    };
}

// 地図の表示を更新する関数
function updateMap(points) {
    // 古いレイヤーをすべて消去
    shinmonLayerGroup.clearLayers();

    const grid_size = 0.1; // 描画するメッシュのサイズ（緯度経度）

    for (const point of points) {
        const lat = parseFloat(point.la);
        const lon = parseFloat(point.lo);
        const psv = parseFloat(point.psv);

        // 揺れが非常に小さい場合は描画しない
        if (psv < 0.5) continue;

        const color = getColorForPSV(psv);

        // 観測点を中心とする四角形のポリゴンを作成
        const bounds = [
            [lat - grid_size / 2, lon - grid_size / 2],
            [lat + grid_size / 2, lon + grid_size / 2]
        ];
        
        // 四角形をレイヤーグループに追加
        L.rectangle(bounds, {
            color: color,      // 枠線の色
            weight: 0,         // 枠線の太さ（0で枠線なし）
            fillColor: color,  // 塗りつぶしの色
            fillOpacity: 0.7   // 透明度
        }).addTo(shinmonLayerGroup);
    }
}

// リアルタイム震度(psv)の値に応じて色を返す関数
function getColorForPSV(psv) {
    if (psv < 0.5) return '#000080'; // 1未満 (紺)
    if (psv < 1.5) return '#0000ff'; // 1-2 (青)
    if (psv < 2.5) return '#00ffff'; // 2-3 (水色)
    if (psv < 3.5) return '#00ff00'; // 3-4 (緑)
    if (psv < 4.5) return '#ffff00'; // 4-5 (黄)
    if (psv < 5.0) return '#ff8c00'; // 5弱 (オレンジ)
    if (psv < 5.5) return '#ff8c00'; // 5強 (オレンジ)
    if (psv < 6.0) return '#ff0000'; // 6弱 (赤)
    if (psv < 6.5) return '#ff0000'; // 6強 (赤)
    return '#800000'; // 7以上 (えんじ)
}