// 変数のグローバルスコープ定義
let map;
let markers;
let pointLatLngList = {};
let slideshowList = localStorage.getItem('slideshowList') ?
    JSON.parse(localStorage.getItem('slideshowList')) : {};

// 地図初期化関数
function initMap() {
    if (map) return;

    // ▼▼▼ URLハッシュから初期位置を決定 ▼▼▼
    let initialZoom = 5.6;
    let initialCenter = [37.575, 137.984]; // デフォルトの中心地（日本全体）

    if (location.hash) {
        const parts = location.hash.substring(1).split('/');
        if (parts.length === 3) {
            const zoom = parseFloat(parts[0]);
            const lat = parseFloat(parts[1]);
            const lng = parseFloat(parts[2]);
            if (!isNaN(zoom) && !isNaN(lat) && !isNaN(lng)) {
                initialZoom = zoom;
                initialCenter = [lat, lng];
            }
        }
    }
    // ▲▲▲ ここまで ▲▲▲

    map = L.map('map', {
        zoomSnap: 0,
        center: initialCenter, // 初期位置を適用
        zoom: initialZoom,     // 初期ズームを適用
        minZoom: 4,
    });

    map.zoomControl.setPosition('topright');
    L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
        attribution: '国土交通省',
    }).addTo(map);

    markers = L.markerClusterGroup({
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 13,
        maxClusterRadius: (zoom) => (zoom <= 6 ? 120 : zoom <= 8 ? 90 : zoom <= 10 ? 60 : 30),
    }).addTo(map);

    // ▼▼▼ 地図の移動/ズーム時にURLハッシュを更新する機能 ▼▼▼
    let shouldUpdateHash = true;
    const updateHash = () => {
        if (!map || !shouldUpdateHash) return;
        const zoom = map.getZoom();
        const center = map.getCenter();
        const lat = center.lat.toFixed(5);
        const lng = center.lng.toFixed(5);
        // location.hash で更新すると履歴に残ってしまうため、replaceStateでURLを置換する
        history.replaceState(null, '', `#${zoom}/${lat}/${lng}`);
    };

    map.on('moveend zoomend', updateHash);
    // ▲▲▲ ここまで ▲▲▲


    loadAllCameraData();
}

// スライドショー編集モーダルを開く関数
function openEditModal() {
    const modal = document.getElementById('div_slideshow_edit');
    const listElement = document.getElementById('slideshow-edit-list');

    listElement.innerHTML = '';
    const savedCams = Object.keys(slideshowList);

    if (savedCams.length === 0) {
        listElement.innerHTML = '<li>保存されているカメラはありません。</li>';
    } else {
        savedCams.forEach(camId => {
            const camName = slideshowList[camId].name;
            const listItem = document.createElement('li');
            listItem.innerHTML = `
                <span>${camName}</span>
                <button class="delete-btn" data-camid="${camId}">削除</button>
            `;
            listElement.appendChild(listItem);
        });
    }
    modal.classList.add('display');
}

// カメラをリストから削除する関数
function removeFromSlideshow(camId) {
    if (slideshowList[camId]) {
        delete slideshowList[camId];
        localStorage.setItem('slideshowList', JSON.stringify(slideshowList));
        openEditModal();
    }
}

document.addEventListener('DOMContentLoaded', function() {
    try {
        initMap();

        document.getElementById('slideshow_start_btn').addEventListener('click', () => {
            const slideshowIds = Object.keys(slideshowList);
            if (slideshowIds.length === 0) {
                alert('スライドショーに表示するカメラがありません。\nマップ上のカメラをクリックして「スライドショーに保存」にチェックを入れてください。');
                return;
            }
            const url = `slideshow.html?cams=${slideshowIds.join(',')}`;
            window.open(url, '_blank');
        });

        document.getElementById('slideshow_edit_btn').addEventListener('click', openEditModal);

        document.getElementById('close_div_slideshow_edit').addEventListener('click', () => {
            document.getElementById('div_slideshow_edit').classList.remove('display');
        });

        document.getElementById('slideshow-edit-list').addEventListener('click', (e) => {
            if (e.target && e.target.classList.contains('delete-btn')) {
                const camId = e.target.dataset.camid;
                removeFromSlideshow(camId);
            }
        });

        document.getElementById('slideshow_select_checkbox').addEventListener('change', function() {
            const camId = this.dataset.camid;
            const camName = this.dataset.camname;
            if (!camId) return;

            if (this.checked) {
                slideshowList[camId] = { name: camName };
            } else {
                delete slideshowList[camId];
            }
            localStorage.setItem('slideshowList', JSON.stringify(slideshowList));
        });

        document.getElementById('close_photoModal').addEventListener('click', () => {
            document.getElementById('photoModal').classList.remove('display');
        });

    } catch (error) {
        console.error('初期化中にエラーが発生しました:', error);
    }
});

class CameraCache {
    constructor() {
        this.store = localStorage;
        this.prefix = 'riverCam_json_';
        this.version = 1;
        this.expiration = 28 * 24 * 60 * 60 * 1000;
    }
    _key(id) { return `${this.prefix}${id}`; }
    _isValid(data) {
        return data && data.version === this.version && (new Date().getTime() - data.timestamp) < this.expiration;
    }
    set(id, value) {
        const data = { version: this.version, timestamp: new Date().getTime(), value: value };
        this.store.setItem(this._key(id), JSON.stringify(data));
    }
    get(id) {
        try {
            const data = JSON.parse(this.store.getItem(this._key(id)));
            if (this._isValid(data)) return data.value;
            this.remove(id);
        } catch (e) { this.remove(id); }
        return null;
    }
    remove(id) { this.store.removeItem(this._key(id)); }
}
const cameraCache = new CameraCache();

function updateCheckboxState(camId, camName) {
    const checkbox = document.getElementById('slideshow_select_checkbox');
    checkbox.dataset.camid = camId;
    checkbox.dataset.camname = camName;
    checkbox.checked = !!slideshowList[camId];
}

function drawMap() {
    if (!markers) return;
    markers.clearLayers();
    const newMarkers = [];

    Object.keys(pointLatLngList).forEach(camId => {
        const camera = pointLatLngList[camId];
        const latlon = new L.LatLng(camera.lat, camera.lng);
        const kariMarker = L.marker(latlon).bindTooltip(camera.name);

        kariMarker.on('click', async () => {
            try {
                document.getElementById('photoModal_photo_name').innerText = camera.name;
                document.getElementById('photoModal_photo_img').src = 'https://placehold.jp/640x480.png?text=Loading...';
                document.getElementById('photoModal').classList.add('display');

                updateCheckboxState(camId, camera.name);

                const response = await fetch(`proxy.php?cam_id=${camId}`);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const camInfo = await response.json();

                let imageUrl = null;
                if (camInfo.obsInfo?.currProvUrl) imageUrl = camInfo.obsInfo.currProvUrl;
                else if (camInfo.currProvUrl) imageUrl = camInfo.currProvUrl;
                else if (camInfo.archiveList?.[0]?.arcUrl) imageUrl = camInfo.archiveList[0].arcUrl;

                if (imageUrl) {
                    document.getElementById('photoModal_photo_img').src = imageUrl;
                } else {
                    throw new Error('画像が見つかりません');
                }
            } catch (error) {
                console.error(`カメラ画像(${camId})の読み込み失敗:`, error);
                document.getElementById('photoModal_photo_img').src = 'https://placehold.jp/640x480.png?text=Error';
            }
        });
        newMarkers.push(kariMarker);
    });
    markers.addLayers(newMarkers);
}

function updateLoadingProgress(done, total) {
    const progressBar = document.getElementById('progress-bar');
    const statusText = document.getElementById('status-text');
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    if (progressBar) {
        progressBar.style.width = percent + '%';
    }
    if (statusText) {
        statusText.textContent = `${done} / ${total} ファイル (${percent}%)`;
    }
}

async function loadAllCameraData() {
    const loader = document.getElementById('loader');

    try {
        const listResponse = await fetch('json_files_list.json');
        if (!listResponse.ok) throw new Error('ファイルリストの取得に失敗');
        const fileList = await listResponse.json();

        const total = fileList.files.length;
        let done = 0;
        updateLoadingProgress(done, total);

        for (const file of fileList.files) {
            const cachedData = cameraCache.get(file);
            if (cachedData) {
                cachedData.forEach(cam => {
                    pointLatLngList[cam.id] = { name: cam.name, lat: cam.lat, lng: cam.lng };
                });
                done++;
                updateLoadingProgress(done, total);
                continue;
            }

            try {
                const response = await fetch('cache/' + file);
                if (!response.ok) {
                    done++;
                    updateLoadingProgress(done, total);
                    continue;
                }

                const data = await response.json();

                if (data.features && Array.isArray(data.features)) {
                    const cameras = data.features
                        .filter(f => f.properties && f.properties.id && f.geometry?.coordinates?.length === 2)
                        .map(f => ({
                            id: f.properties.id.toString(),
                            name: f.properties.name || '',
                            lat: f.geometry.coordinates[1],
                            lng: f.geometry.coordinates[0]
                        }));
                    if (cameras.length > 0) {
                        cameraCache.set(file, cameras);
                        cameras.forEach(cam => {
                            pointLatLngList[cam.id] = { name: cam.name, lat: cam.lat, lng: cam.lng };
                        });
                    }
                }
            } catch (err) {
                console.warn(`ファイル ${file} の読み込みエラー:`, err);
            }

            done++;
            updateLoadingProgress(done, total);
        }

        drawMap();

    } catch (error) {
        console.error('データ読み込みエラー:', error);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}
