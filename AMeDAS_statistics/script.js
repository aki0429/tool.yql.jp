document.addEventListener('DOMContentLoaded', () => {
    const summerBtn = document.getElementById('summerBtn');
    const winterBtn = document.getElementById('winterBtn');
    const summerStats = document.getElementById('summerStats');
    const winterStats = document.getElementById('winterStats');
    const lastUpdate = document.getElementById('lastUpdate');

    // 季節の切り替え機能
    summerBtn.addEventListener('click', () => {
        summerStats.classList.remove('hidden');
        winterStats.classList.add('hidden');
        summerBtn.classList.add('active');
        winterBtn.classList.remove('active');
    });

    winterBtn.addEventListener('click', () => {
        winterStats.classList.remove('hidden');
        summerStats.classList.add('hidden');
        winterBtn.classList.add('active');
        summerBtn.classList.remove('active');
    });

    // キャッシュ用のオブジェクト
    const dataCache = {};

    // キャッシュにデータを追加する関数
    function cacheData(date, data) {
        // キャッシュの最大サイズを設定（例：100件）
        const maxCacheSize = 100;
        // キャッシュの有効期限を設定（例：1日）
        const cacheExpiration = 24 * 60 * 60 * 1000; // ミリ秒

        dataCache[date] = {
            time: new Date(),
            data: data
        };

        // キャッシュのサイズが上限を超えたら古いデータを削除
        if (Object.keys(dataCache).length > maxCacheSize) {
            const oldestDate = Object.keys(dataCache).reduce((a, b) => new Date(a) < new Date(b) ? a : b);
            delete dataCache[oldestDate];
        }

        // 定期的にキャッシュをクリアする（例：1時間に1回）
        setInterval(() => {
            const now = new Date();
            Object.keys(dataCache).forEach(date => {
                if (now - new Date(dataCache[date].time) > cacheExpiration) {
                    delete dataCache[date];
                }
            });
        }, 60 * 60 * 1000);
    }

    // キャッシュからデータを取得する関数
    function getDataFromCache(date) {
        const cachedData = dataCache[date];
        if (cachedData) {
            return cachedData.data;
        }
        return null;
    }

    // AMeDASデータを取得する関数
    async function fetchAmedasData() {
        const now = new Date();
        const latestDate = new Date();
        latestDate.setDate(latestDate.getDate() - 1); // 前日に設定

        const dateString = latestDate.toISOString().split('T')[0]; // YYYY-MM-DD形式

        const cachedData = getDataFromCache(dateString);
        if (cachedData) {
            console.log('キャッシュからデータを取得しました', cachedData);
            return cachedData; // キャッシュされたデータを返す
        }

        // 気象庁のAPIからデータを取得する処理
        const timeResponse = await fetch('https://www.jma.go.jp/bosai/amedas/data/latest_time.txt');
        if (!timeResponse.ok) {
            throw new Error(`最新時刻の取得に失敗しました (${timeResponse.status})`);
        }
        const latestTimeISO = await timeResponse.text();
        console.log('取得した時刻(ISO):', latestTimeISO);

        const latestTime = new Date(latestTimeISO);
        latestTime.setDate(latestTime.getDate() - 1); // 前日に設定

        const startHour = 0; // 0時
        const endHour = 23; // 23時まで
        const observationData = [];

        // 0時から23時までのデータを10分ごとに取得
        for (let hour = startHour; hour <= endHour; hour++) {
            for (let minute = 0; minute < 60; minute += 10) {
                const timeString = `${latestTime.getFullYear()}${String(latestTime.getMonth() + 1).padStart(2, '0')}${String(latestTime.getDate()).padStart(2, '0')}${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`;
                const observationUrl = `https://www.jma.go.jp/bosai/amedas/data/map/${timeString}.json`;
                console.log('観測データURL:', observationUrl);
                
                const response = await fetch(observationUrl);
                if (!response.ok) {
                    console.error(`データ取得失敗: ${timeString}`);
                    continue;
                }

                const data = await response.json();
                observationData.push(data);

                // データをキャッシュする
                cacheData(dateString, data);
            }
        }

        // 統計の計算
        let stats = {
            extremeHotCount: 0,  // 猛暑日 (35℃以上)
            veryHotCount: 0,     // 真夏日 (30℃以上)
            hotCount: 0,         // 夏日 (25℃以上)
            extremeColdCount: 0, // 真冬日 (最高気温が0℃未満)
            coldCount: 0         // 冬日 (最低気温が0℃未満)
        };

        // 各地点のデータを解析
        for (const data of observationData) {
            if (data && data.temp && Array.isArray(data.temp)) {
                const temp = data.temp[0];  // 現在の気温
                
                // クオリティコードが0（正常値）の場合のみ処理
                if (data.temp[1] === 0 && temp !== null) {
                    // 夏季の統計
                    if (temp >= 35) stats.extremeHotCount++;
                    if (temp >= 30) stats.veryHotCount++;
                    if (temp >= 25) stats.hotCount++;
                    
                    // 冬季の統計（真冬日）
                    if (temp < 0) stats.extremeColdCount++;
                    
                    // 冬日の判定（最低気温が0℃未満）
                    if (temp < 0) stats.coldCount++;
                }
            }
        }

        console.log('統計計算結果:', stats);

        // 統計の更新
        updateStatistics(stats);
        
        // 最終更新時刻の更新
        lastUpdate.textContent = latestTime.toLocaleString('ja-JP');
    }

    function updateStatistics(stats) {
        document.getElementById('extremeHotCount').textContent = stats.extremeHotCount;
        document.getElementById('veryHotCount').textContent = stats.veryHotCount;
        document.getElementById('hotCount').textContent = stats.hotCount;
        document.getElementById('extremeColdCount').textContent = stats.extremeColdCount;
        document.getElementById('coldCount').textContent = stats.coldCount;
    }

    // 初回データ取得
    fetchAmedasData();

    // 定期的なデータ更新（10分ごと）
    setInterval(fetchAmedasData, 600000);
});
