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

    // --- キャッシュ関連の定数と関数 ---
    const CACHE_KEY_PREFIX = 'amedas-stats-cache-';
    const CACHE_EXPIRATION_MS = 90 * 1000; // キャッシュの有効期限を90秒に設定（当日のため短縮）

    /**
     * ローカルストレージから指定日のキャッシュを取得する
     * @param {string} dateString - 'YYYY-MM-DD'形式の日付文字列
     * @returns {object|null} - キャッシュデータ、またはnull
     */
    function getCache(dateString) {
        const cacheKey = CACHE_KEY_PREFIX + dateString;
        const cachedItem = localStorage.getItem(cacheKey);
        if (!cachedItem) {
            return null;
        }

        const { timestamp, data } = JSON.parse(cachedItem);
        // 有効期限をチェック
        if (Date.now() - timestamp > CACHE_EXPIRATION_MS) {
            localStorage.removeItem(cacheKey); // 期限切れのキャッシュを削除
            console.log(`キャッシュ(key: ${cacheKey})は期限切れのため削除しました。`);
            return null;
        }
        return data;
    }

    /**
     * 計算済みの統計データをローカルストレージに保存する
     * @param {string} dateString - 'YYYY-MM-DD'形式の日付文字列
     * @param {object} data - 保存する統計データ
     */
    function setCache(dateString, data) {
        const cacheKey = CACHE_KEY_PREFIX + dateString;
        const itemToCache = {
            timestamp: Date.now(),
            data: data
        };
        try {
            localStorage.setItem(cacheKey, JSON.stringify(itemToCache));
            console.log(`統計データをキャッシュに保存しました (key: ${cacheKey})`);
        } catch (e) {
            console.error('ローカルストレージへの保存に失敗しました。ストレージが満杯の可能性があります。', e);
        }
    }

    /**
     * AMeDASデータを取得し、統計を計算・表示するメイン関数
     */
    async function fetchAndProcessAmedasData() {
        setLoadingState(true); // UIを「計算中」表示に

        // --- 変更点 1: 集計対象を当日に変更 ---
        const targetDate = new Date();
        // targetDate.setDate(targetDate.getDate() - 1); // 前日を取得する行を削除
        const dateString = targetDate.toISOString().split('T')[0]; // 'YYYY-MM-DD'形式

        // 1. まずキャッシュを確認
        const cachedStats = getCache(dateString);
        if (cachedStats) {
            console.log('有効なキャッシュが見つかりました。キャッシュからデータを表示します。');
            updateStatisticsUI(cachedStats);
            updateLastUpdateDate(targetDate);
            setLoadingState(false);
            return; // キャッシュがあったので処理終了
        }

        console.log('キャッシュがないか期限切れです。気象庁APIから新規にデータを取得・集計します。');
        console.warn('この処理は時間がかかる場合があります...');

        try {
            // 2. 地点ごとの日最高・最低気温を記録するオブジェクト
            const dailyTemperatures = {}; // 構造: { "地点コード": { max: -Infinity, min: Infinity } }

            const datePrefix = `${targetDate.getFullYear()}${String(targetDate.getMonth() + 1).padStart(2, '0')}${String(targetDate.getDate()).padStart(2, '0')}`;

            // 3. 当日の00:00から現在時刻までのデータを10分ごとに取得し、最高・最低気温を更新
            for (let hour = 0; hour < 24; hour++) {
                for (let minute = 0; minute < 60; minute += 10) {
                    // 未来の時刻のデータは存在しないため、リクエストをスキップ
                    const now = new Date();
                    const requestTime = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), hour, minute);
                    if (requestTime > now) {
                        // ループを抜けて集計処理へ
                        hour = 24;
                        minute = 60;
                        continue;
                    }

                    const timeString = `${datePrefix}${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}00`;
                    const url = `https://www.jma.go.jp/bosai/amedas/data/map/${timeString}.json`;

                    try {
                        const response = await fetch(url);
                        if (response.ok) {
                            const data = await response.json();
                            for (const stationCode in data) {
                                const stationData = data[stationCode];
                                const temp = stationData.temp ? stationData.temp[0] : null;
                                const quality = stationData.temp ? stationData.temp[1] : -1;

                                if (quality === 0 && temp !== null) { // 正常な値のみ
                                    if (!dailyTemperatures[stationCode]) {
                                        dailyTemperatures[stationCode] = { max: -Infinity, min: Infinity, hasData: false };
                                    }
                                    dailyTemperatures[stationCode].max = Math.max(dailyTemperatures[stationCode].max, temp);
                                    dailyTemperatures[stationCode].min = Math.min(dailyTemperatures[stationCode].min, temp);
                                    dailyTemperatures[stationCode].hasData = true;
                                }
                            }
                        }
                    } catch (error) {
                        // 一部の時刻でデータが取得できなくても処理を継続する
                        console.warn(`時刻 ${timeString} のデータ取得に失敗しました。処理を続行します。`);
                    }
                }
            }

            // 4. 正しい定義に基づいて統計を計算
            const stats = {
                extremeHotCount: 0,  // 猛暑日 (最高気温 >= 35℃)
                veryHotCount: 0,     // 真夏日 (最高気温 >= 30℃)
                hotCount: 0,         // 夏日   (最高気温 >= 25℃)
                extremeColdCount: 0, // 真冬日 (最高気温 < 0℃)
                coldCount: 0         // 冬日   (最低気温 < 0℃)
            };

            for (const stationCode in dailyTemperatures) {
                const temps = dailyTemperatures[stationCode];
                if (!temps.hasData) continue; // 有効なデータがなかった地点はスキップ

                if (temps.max >= 35) stats.extremeHotCount++;
                if (temps.max >= 30) stats.veryHotCount++;
                if (temps.max >= 25) stats.hotCount++;
                if (temps.max < 0) stats.extremeColdCount++;
                if (temps.min < 0) stats.coldCount++;
            }
            
            console.log('集計が完了しました。', stats);

            // 5. 結果をUIに反映し、キャッシュに保存
            updateStatisticsUI(stats);
            updateLastUpdateDate(targetDate);
            setCache(dateString, stats);

        } catch (error) {
            console.error('データ取得または集計中に致命的なエラーが発生しました:', error);
            lastUpdate.textContent = 'データ取得・集計に失敗しました。';
        } finally {
            setLoadingState(false); // UIを通常表示に戻す
        }
    }

    /**
     * UIの表示を更新する
     * @param {object} stats - 表示する統計データ
     */
    function updateStatisticsUI(stats) {
        document.getElementById('extremeHotCount').textContent = stats.extremeHotCount;
        document.getElementById('veryHotCount').textContent = stats.veryHotCount;
        document.getElementById('hotCount').textContent = stats.hotCount;
        document.getElementById('extremeColdCount').textContent = stats.extremeColdCount;
        document.getElementById('coldCount').textContent = stats.coldCount;
    }

    /**
     * 集計対象の日付をUIに表示する
     * @param {Date} date - 集計対象日
     */
    function updateLastUpdateDate(date) {
        lastUpdate.textContent = `${date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })} の集計データ`;
    }

    /**
     * 処理中のロード状態をUIに反映させる
     * @param {boolean} isLoading - 処理中かどうか
     */
    function setLoadingState(isLoading) {
        const loadingText = '計算中...';
        if (isLoading) {
            document.querySelectorAll('.count').forEach(el => el.textContent = loadingText);
            // --- 変更点 2: メッセージを当日に変更 ---
            lastUpdate.textContent = '本日のデータを集計しています...';
        }
    }


    // --- 初期実行と定期実行 ---
    
    // ページ読み込み時に初回データを取得・計算
    fetchAndProcessAmedasData();

    // 15分ごとにキャッシュの有効性を確認し、必要であればデータを再取得する
    // 当日データを扱うため、更新頻度を少し高めます
    setInterval(fetchAndProcessAmedasData, 60 * 1000);
});