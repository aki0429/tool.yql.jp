const express = require('express');
const Jimp = require('jimp');
const fetch = require('node-fetch');
const fs = require('fs');
const csv = require('csv-parser');
const iconv = require('iconv-lite');

const app = express();
const PORT = 3000;

// --- 定数定義 ---
const POINTER_API_URL = 'http://www.kmoni.bosai.go.jp/webservice/server/pros/latest.json';
const GIF_URL_BASE = 'http://www.kmoni.bosai.go.jp/data/map_img/RealTimeImg/jma_s/';
const STATIONS_CSV_PATH = 'sitepub_all_sj.csv'; // 観測点情報CSVのパス

// --- 地図投影に関する定数 ---
// 強震モニタの地図画像(jma_s.gif)の地理的範囲とサイズを定義
// 注意: これらの値は目視による推定であり、完璧な精度ではない可能性があります。
const MAP_BOUNDS = {
    latMin: 24.0,
    latMax: 46.0,
    lonMin: 122.0,
    lonMax: 149.0,
};
const IMAGE_DIMS = {
    width: 352,
    height: 400,
};


// --- グローバル変数 ---
let allStations = []; // CSVから読み込んだ全観測点データ

// --- ヘルパー関数 ---

/**
 * 緯度経度を地図画像のピクセル座標(x, y)に変換する（地図投影）
 * @param {number} lat - 緯度
 * @param {number} lon - 経度
 * @returns {{x: number, y: number}|null} 計算されたピクセル座標。範囲外の場合はnull。
 */
function projectCoordinates(lat, lon) {
    // 緯度経度が地図の範囲外であれば、計算対象外とする
    if (lat < MAP_BOUNDS.latMin || lat > MAP_BOUNDS.latMax || lon < MAP_BOUNDS.lonMin || lon > MAP_BOUNDS.lonMax) {
        return null;
    }

    // 経度からx座標を計算 (線形補間)
    const x = Math.round(IMAGE_DIMS.width * (lon - MAP_BOUNDS.lonMin) / (MAP_BOUNDS.lonMax - MAP_BOUNDS.lonMin));

    // 緯度からy座標を計算 (線形補間)
    // y座標は上が0なので、(latMax - lat)で上下を反転させる
    const y = Math.round(IMAGE_DIMS.height * (MAP_BOUNDS.latMax - lat) / (MAP_BOUNDS.latMax - MAP_BOUNDS.latMin));

    return { x, y };
}


/**
 * 2つのRGB色の距離を計算する
 * @param {number[]} rgb1 - 1つ目の色 [r, g, b]
 * @param {number[]} rgb2 - 2つ目の色 [r, g, b]
 * @returns {number} 色の距離
 */
const colorDistance = (rgb1, rgb2) => Math.sqrt(Math.pow(rgb1[0] - rgb2[0], 2) + Math.pow(rgb1[1] - rgb2[1], 2) + Math.pow(rgb1[2] - rgb2[2], 2));

/**
 * CSVから観測点データを読み込む
 * @param {string} csvFilePath - 観測点情報CSVのパス
 * @returns {Promise<object[]>} 観測点データの配列
 */
function loadStationsFromCSV(csvFilePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(csvFilePath)
            .pipe(iconv.decodeStream('sjis')) // Shift_JISからUTF-8へ変換
            .pipe(csv({
                // CSVのヘッダーを定義
                headers: ['code', 'name_jp', 'name_en', 'lat', 'lon', 'alt', 'depth', 'pref_jp', 'pref_en', 'type', 'dummy1', 'status_jp', 'status_en', 'dummy2', 'id', 'start_date'],
                skipLines: 1 // 1行目のヘッダー行をスキップ
            }))
            .on('data', (row) => {
                // 休止中の観測点や、緯度経度が無効なデータは除外
                if (row.status_jp !== '休止' && row.lat && row.lon) {
                    results.push({
                        name: row.name_jp,
                        lat: parseFloat(row.lat),
                        lon: parseFloat(row.lon),
                    });
                }
            })
            .on('end', () => {
                console.log(`[Server Startup] ${results.length} active stations loaded from CSV.`);
                resolve(results);
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

// CORSミドルウェア
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    next();
});

// --- メインのAPIエンドポイント ---
app.get('/api/station-colors', async (req, res) => {
    console.log('[Request] /api/station-colors received.');
    if (allStations.length === 0) {
        return res.status(503).json({ error: 'Station data is not ready. Please try again later.' });
    }

    try {
        // ステップ1: 最新時刻を取得
        const pointerResponse = await fetch(POINTER_API_URL);
        if (!pointerResponse.ok) throw new Error(`Timestamp fetch failed: ${pointerResponse.statusText}`);
        const pointerData = await pointerResponse.json();
        const latestTimeStr = pointerData.latest_time;
        if (!latestTimeStr) throw new Error('latest_time not found.');

        // ステップ2: 有効なGIF画像をリトライしながら探す
        const [datePart, timePart] = latestTimeStr.split(' ');
        const [year, month, day] = datePart.split('/');
        const [hour, minute, second] = timePart.split(':');
        const latestTime = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
        
        let imageBuffer = null;
        let imageTimestamp = '';

        for (let i = 0; i < 15; i++) {
            const targetTime = new Date(latestTime.getTime() - i * 1000);
            const yyyy = targetTime.getUTCFullYear();
            const mm = String(targetTime.getUTCMonth() + 1).padStart(2, '0');
            const dd = String(targetTime.getUTCDate()).padStart(2, '0');
            const HH = String(targetTime.getUTCHours()).padStart(2, '0');
            const MM = String(targetTime.getUTCMinutes()).padStart(2, '0');
            const SS = String(targetTime.getUTCSeconds()).padStart(2, '0');
            const yyyymmdd = `${yyyy}${mm}${dd}`;
            const hhmmss = `${HH}${MM}${SS}`;
            const gifUrl = `${GIF_URL_BASE}${yyyymmdd}/${yyyymmdd}${hhmmss}.jma_s.gif`;

            try {
                const gifResponse = await fetch(gifUrl);
                if (gifResponse.ok) {
                    imageBuffer = await gifResponse.buffer();
                    imageTimestamp = `${yyyy}/${mm}/${dd} ${HH}:${MM}:${SS} (UTC)`;
                    console.log(`[Server] GIF Fetched: ${gifUrl}`);
                    break;
                }
            } catch (e) { /* 無視 */ }
        }

        if (!imageBuffer) throw new Error('Failed to fetch any valid GIF in the last 15 seconds.');

        // ステップ3: 画像を解析し、色のリストを作成
        const image = await Jimp.read(imageBuffer);
        const colorDataList = [];
        for (const station of allStations) {
            // 緯度経度からピクセル座標を動的に計算
            const coords = projectCoordinates(station.lat, station.lon);
            if (!coords) continue; // 地図の範囲外の観測点はスキップ

            const colorInt = image.getPixelColor(coords.x, coords.y);
            const rgba = Jimp.intToRGBA(colorInt);
            const rgb = [rgba.r, rgba.g, rgba.b];

            // 背景色に近い色(透明や薄いグレーなど)は除外
            if (rgba.a > 128 && colorDistance(rgb, [230, 230, 230]) > 50) {
                 colorDataList.push([
                     station.lat,
                     station.lon,
                     rgb
                 ]);
            }
        }
        
        // ステップ4: 解析結果のJSONをブラウザに返す
        res.json({
            timestamp: imageTimestamp,
            station_data: colorDataList // 形式: [ [lat, lon, [r,g,b]], ... ]
        });

    } catch (error) {
        console.error('[Server Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// --- サーバー起動処理 ---
(async () => {
    try {
        console.log('[Server Startup] Loading station data from CSV...');
        // CSVから観測点データを読み込み、グローバル変数に格納
        allStations = await loadStationsFromCSV(STATIONS_CSV_PATH);
        
        app.listen(PORT, () => {
            console.log(`Shindo Data Server is running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error('[Server Startup Error] Failed to initialize station data:', error);
        process.exit(1); // 起動に失敗した場合はプロセスを終了
    }
})();
