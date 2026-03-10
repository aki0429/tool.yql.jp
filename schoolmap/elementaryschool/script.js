// 1. 地図の初期化
const map = L.map('map').setView([35.09, 136.1], 13); // 初期位置を仮設定

// 2. 背景地図の追加
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// --- UI要素を取得 ---
const infoPanel = document.getElementById('info-panel');
const infoTitle = document.getElementById('info-title');
const infoDetails = document.getElementById('info-details');
const closeBtn = document.getElementById('close-btn');
const loader = document.getElementById('loader');
const progressBar = document.getElementById('progress-bar');
const statusText = document.getElementById('status-text');
let selectedLayer = null;
let geoJsonLayer;

// --- パネルの閉じるボタンの処理 ---
closeBtn.addEventListener('click', () => {
    infoPanel.classList.add('hidden');
    if (selectedLayer) {
        geoJsonLayer.resetStyle(selectedLayer);
        selectedLayer = null;
    }
});

// 3. 複数のGeoJSONファイルを読み込む
const promises = [];
const totalFiles = 47;
let loadedFiles = 0;

// プログレスバーを更新する関数
function updateProgress() {
    loadedFiles++;
    const percentage = Math.round((loadedFiles / totalFiles) * 100);
    progressBar.style.width = percentage + '%';
    statusText.textContent = `${loadedFiles} / ${totalFiles} ファイル (${percentage}%)`;
}

for (let i = 1; i <= totalFiles; i++) {
    const filename = `A27-23_${String(i).padStart(2, '0')}.geojson`;
    promises.push(
        fetch(filename)
        .then(response => {
            if (!response.ok) {
                console.warn(`ファイルが見つかりません: ${filename}`);
                return null; // ファイルが存在しない場合はnullを返す
            }
            return response.json();
        })
        .catch(err => {
            console.error(`読み込みエラー: ${filename}`, err);
            return null; // エラーの場合もnullを返す
        })
        .finally(() => {
            // 成功・失敗にかかわらずプログレスを更新
            updateProgress();
        })
    );
}

// 全てのファイル読み込みが完了するのを待つ
Promise.all(promises)
    .then(allData => {
        const validData = allData.filter(data => data !== null);
        const allFeatures = validData.reduce((acc, geoJson) => {
            if (geoJson) {
                if (geoJson.type === 'FeatureCollection') {
                    return acc.concat(geoJson.features);
                } else if (geoJson.type === 'Feature') {
                    acc.push(geoJson);
                    return acc;
                }
            }
            return acc;
        }, []);

        if (allFeatures.length === 0) {
            throw new Error('有効なGeoJSONデータが一つも読み込めませんでした。');
        }

        const combinedData = {
            "type": "FeatureCollection",
            "features": allFeatures
        };

        geoJsonLayer = L.geoJSON(combinedData, {
            style: function(feature) {
                return { color: '#3388ff', weight: 2, opacity: 1, fillOpacity: 0.5 };
            },
            onEachFeature: function (feature, layer) {
                const properties = feature.properties;
                if (feature.geometry.type.includes('Polygon') && properties) {
                    layer.on('click', function () {
                        if (selectedLayer) {
                            geoJsonLayer.resetStyle(selectedLayer);
                        }
                        infoTitle.textContent = properties.A27_004 || '名称未設定';
                        let detailsHtml = `<p><strong>住所:</strong> ${properties.A27_005 || '情報なし'}</p>`
                                        + `<p><strong>種別:</strong> ${properties.A27_002 || '情報なし'}</p>`
                                        + `<p><strong>ID:</strong> ${properties.A27_001 || '情報なし'}</p>`;
                        infoDetails.innerHTML = detailsHtml;
                        infoPanel.classList.remove('hidden');
                        layer.setStyle({ weight: 4, color: '#ff7800' });
                        layer.bringToFront();
                        selectedLayer = layer;
                    });
                }
            }
        }).addTo(map);

        map.fitBounds(geoJsonLayer.getBounds());
    })
    .catch(error => {
        console.error('GeoJSONの読み込みに失敗しました:', error);
        const errorDiv = document.createElement('div');
        errorDiv.innerHTML = 'GeoJSONファイルの読み込みに失敗しました。<br>ファイル名やコンソールを確認してください。';
        errorDiv.style.position = 'absolute';
        errorDiv.style.top = '10px';
        errorDiv.style.left = '50px';
        errorDiv.style.zIndex = 1000;
        errorDiv.style.backgroundColor = 'white';
        errorDiv.style.padding = '10px';
        errorDiv.style.border = '2px solid red';
        document.body.appendChild(errorDiv);
    })
    .finally(() => {
        // 成功・失敗にかかわらずローディング画面を非表示にする
        loader.style.display = 'none';
    });
