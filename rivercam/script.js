// 変数のグローバルスコープ定義
function createMemoryStorage() {
    const values = new Map();
    return {
        getItem: (key) => values.has(key) ? values.get(key) : null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
    };
}

function getAppStorage() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.getItem('__rivercam_storage_test__');
            return window.localStorage;
        }
    } catch (error) {
        console.warn('ブラウザ保存領域を利用できないため、この画面内だけで設定を保持します。');
    }
    return createMemoryStorage();
}

const appStorage = getAppStorage();

function readSlideshowList() {
    try {
        const value = appStorage.getItem('slideshowList');
        if (!value) return {};
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        appStorage.removeItem('slideshowList');
        return {};
    }
}

function saveSlideshowList() {
    try {
        appStorage.setItem('slideshowList', JSON.stringify(slideshowList));
    } catch (error) {
        console.warn('スライドショー設定を保存できませんでした。');
    }
}

let map;
let markers;
let pointLatLngList = {};
let slideshowList = readSlideshowList();
let radarLayer; // 雨雲レーダーレイヤー
let baseMap; // ベースマップ
let layerControl;
let waterGaugeLayer;
let riverWarningLayer;
let waterGaugeLoadTimer;
let activeGaugeController;
let activeWarningController;
let activeDetailController;
let gaugeRequestSequence = 0;
let warningRequestSequence = 0;
let lastGaugeRequestKey = '';
let selectedGaugeId = '';
let selectedGaugeData = null;
let selectedGraphHours = 24;
let waterModalReturnFocus = null;
let visibleWaterGaugeStations = [];

const RIVER_DATA_API = 'river_data.php';
const WATER_GAUGE_DETAIL_ZOOM = 7;
const SAME_LOCATION_DISTANCE_METERS = 20;
const RIVER_DATA_CACHE_TTL_MS = 5 * 60 * 1000;
const WATER_GAUGE_RENDER_PADDING = 0.08;
const WATER_GAUGE_FETCH_PADDING = 0.45;
const RAIN_RADAR_REFRESH_MS = 5 * 60 * 1000;
const RAIN_RADAR_TARGET_TIMES_URL = 'https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json';
const riverLoadState = {
    gauges: { loading: false, progress: 0, error: '', count: 0, updatedAt: '' },
    warnings: { loading: false, progress: 0, error: '', count: 0, totalCount: 0, updatedAt: '' },
};
let waterGaugeResponseCache = null;
let riverWarningResponseCache = null;
let nationwideGaugeCache = null;
let nationwideGaugeTimer = null;
let nationwideGaugeRefreshSeq = 0;
let fetchingNationwideGauges = false;
let waterGaugeRenderSequence = 0;
let cameraRenderSequence = 0;
let waterGaugeSpatialIndex = new Map();
let cameraSpatialIndex = new Map();

const SPATIAL_CELL_SIZE = 0.0003;
const WATER_GAUGE_RENDER_BATCH_SIZE = 160;

const WATER_LEVEL_STYLES = [
    { minimum: 90, rank: 5, label: '氾濫発生', color: '#140014', textColor: '#ffffff' },
    { minimum: 80, rank: 4, label: '氾濫危険', color: '#aa00aa', textColor: '#ffffff' },
    { minimum: 60, rank: 3, label: '避難判断', color: '#ff2800', textColor: '#ffffff' },
    { minimum: 30, rank: 2, label: '氾濫注意', color: '#f2e700', textColor: '#182230' },
    { minimum: 10, rank: 1, label: '水防団待機', color: '#35a86b', textColor: '#ffffff' },
    { minimum: 0, rank: 0, label: '通常', color: '#66ccff', textColor: '#182230' },
];

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
        center: initialCenter,
        zoom: initialZoom,
        minZoom: 4,
        preferCanvas: true,
    });

    map.zoomControl.setPosition('topright');

    // ベースマップの定義
    baseMap = {
        "地理院地図 標準": L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html">国土地理院</a>',
            maxNativeZoom: 18,
        }),
        "Google Maps": L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
            attribution: '&copy; Google',
        })
    };

    // デフォルトのベースマップをマップに追加
    baseMap["地理院地図 標準"].addTo(map);

    markers = L.markerClusterGroup({
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 13,
        maxClusterRadius: (zoom) => (zoom <= 6 ? 120 : zoom <= 8 ? 90 : zoom <= 10 ? 60 : 30),
    }).addTo(map);

    map.createPane('riverWarningsPane');
    map.getPane('riverWarningsPane').style.zIndex = 410;

    riverWarningLayer = L.geoJSON(null, {
        pane: 'riverWarningsPane',
        style: styleRiverWarning,
        onEachFeature: bindRiverWarningPopup,
    }).addTo(map);

    waterGaugeLayer = L.markerClusterGroup({
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 12,
        maxClusterRadius: (zoom) => (zoom <= 7 ? 70 : zoom <= 9 ? 52 : 38),
        iconCreateFunction: createWaterGaugeClusterIcon,
    }).addTo(map);

    layerControl = L.control.layers(baseMap, {
        '河川カメラ': markers,
        '水位計': waterGaugeLayer,
        '警報河川': riverWarningLayer,
    }, { position: 'topright', collapsed: false }).addTo(map);

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
    map.on('moveend zoomend', () => scheduleWaterGaugeLoad(false));
    map.on('overlayadd', (event) => {
        if (event.layer === waterGaugeLayer) scheduleWaterGaugeLoad(true);
        if (event.layer === riverWarningLayer && riverWarningLayer.getLayers().length === 0) {
            loadRiverWarnings(true);
        }
    });
    // ▲▲▲ ここまで ▲▲▲


    setTimeout(function () { loadAllCameraData(); }, 100);
    loadRiverWarnings();
    scheduleWaterGaugeLoad(true);
    scheduleNationwideGaugeRefresh();

    setTimeout(function () {
      createRadarLayer().then(layer => {
        if (layer) {
          radarLayer = layer;
          layerControl.addOverlay(radarLayer, '気象庁 雨雲レーダー');
        }
      });
    }, 2000);
}

// 雨雲レーダーレイヤーを作成する関数
function fallbackRadarTime() {
    const baseTime = new Date();
    const bufferMinutes = 10;
    baseTime.setUTCMinutes(baseTime.getUTCMinutes() - (baseTime.getUTCMinutes() % 5) - bufferMinutes);
    baseTime.setUTCSeconds(0);
    baseTime.setUTCMilliseconds(0);

    const timestamp = baseTime.getUTCFullYear() +
        String(baseTime.getUTCMonth() + 1).padStart(2, '0') +
        String(baseTime.getUTCDate()).padStart(2, '0') +
        String(baseTime.getUTCHours()).padStart(2, '0') +
        String(baseTime.getUTCMinutes()).padStart(2, '0') +
        '00';
    return { basetime: timestamp, validtime: timestamp };
}

async function fetchLatestRadarTime() {
    const response = await fetch(`${RAIN_RADAR_TARGET_TIMES_URL}?_=${Date.now()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const times = await response.json();
    if (!Array.isArray(times)) throw new Error('雨雲レーダーの時刻一覧が不正です。');
    const latest = times.find((item) =>
        item
        && typeof item.basetime === 'string'
        && typeof item.validtime === 'string'
        && Array.isArray(item.elements)
        && item.elements.includes('hrpns'));
    if (!latest) throw new Error('雨雲レーダーの最新時刻が見つかりません。');
    return { basetime: latest.basetime, validtime: latest.validtime };
}

function radarTimeKey(time) {
    return `${time?.basetime || ''}:${time?.validtime || ''}`;
}

function radarTileBaseUrl(time) {
    return `https://www.jma.go.jp/bosai/jmatile/data/nowc/${time.basetime}/none/${time.validtime}/surf/hrpns`;
}

async function createRadarLayer() {
    const baseTime = new Date();
    const bufferMinutes = 10;
    baseTime.setUTCMinutes(baseTime.getUTCMinutes() - (baseTime.getUTCMinutes() % 5) - bufferMinutes);
    baseTime.setUTCSeconds(0);
    baseTime.setUTCMilliseconds(0);

    const baseTimestamp = baseTime.getUTCFullYear() +
        String(baseTime.getUTCMonth() + 1).padStart(2, '0') +
        String(baseTime.getUTCDate()).padStart(2, '0') +
        String(baseTime.getUTCHours()).padStart(2, '0') +
        String(baseTime.getUTCMinutes()).padStart(2, '0') +
        '00';

    const baseUrl = `https://www.jma.go.jp/bosai/jmatile/data/nowc/${baseTimestamp}/none/${baseTimestamp}/surf/hrpns`;

    let initialRadarTime = { basetime: baseTimestamp, validtime: baseTimestamp };
    try {
        initialRadarTime = await fetchLatestRadarTime();
    } catch (error) {
        console.warn('雨雲レーダーの最新時刻を取得できないため、推定時刻で表示します。', error);
    }

    const RadarTileLayer = L.TileLayer.extend({
        initialize: function (url, options) {
            L.TileLayer.prototype.initialize.call(this, url, options);
            this._radarTime = options.radarTime || fallbackRadarTime();
            this._refreshTimer = null;
        },
        onAdd: function (mapObject) {
            L.TileLayer.prototype.onAdd.call(this, mapObject);
            this._startRadarRefresh();
            this._refreshRadarTime();
        },
        onRemove: function (mapObject) {
            this._stopRadarRefresh();
            L.TileLayer.prototype.onRemove.call(this, mapObject);
        },
        _startRadarRefresh: function () {
            this._stopRadarRefresh();
            this._refreshTimer = setInterval(() => this._refreshRadarTime(), RAIN_RADAR_REFRESH_MS);
        },
        _stopRadarRefresh: function () {
            if (this._refreshTimer) clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        },
        _refreshRadarTime: async function () {
            try {
                const latest = await fetchLatestRadarTime();
                if (radarTimeKey(latest) === radarTimeKey(this._radarTime)) return;
                this._radarTime = latest;
                this.redraw();
            } catch (error) {
                console.warn('雨雲レーダーの更新確認に失敗しました。', error);
            }
        },
        // タイル生成をカスタマイズ
        createTile: function (coords, done) {
            const tileSize = 256;
            const tile = document.createElement('canvas');
            tile.width = tile.height = tileSize;
            const ctx = tile.getContext('2d');
            const baseUrl = radarTileBaseUrl(this._radarTime);

            // 気象庁タイルの提供倍率は4・6・8・10。中間倍率は直下を拡大し、
            // ズーム2・3はズーム4の子タイルを縮小合成して空白を防ぐ。
            const nativeZoom = coords.z < 4
                ? 4
                : Math.min(10, coords.z - (coords.z % 2));
            const zoomDiff = coords.z - nativeZoom;
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';

            const loadImage = (url) => new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = url;
            });

            if (zoomDiff >= 0) {
                const scale = Math.pow(2, zoomDiff);
                const x = Math.floor(coords.x / scale);
                const y = Math.floor(coords.y / scale);
                const sourceSize = tileSize / scale;
                const sx = ((coords.x % scale) + scale) % scale * sourceSize;
                const sy = ((coords.y % scale) + scale) % scale * sourceSize;

                loadImage(`${baseUrl}/${nativeZoom}/${x}/${y}.png`).then((img) => {
                    if (img) ctx.drawImage(img, sx, sy, sourceSize, sourceSize, 0, 0, tileSize, tileSize);
                    done(null, tile);
                });
            } else {
                const childScale = Math.pow(2, -zoomDiff);
                const destinationSize = tileSize / childScale;
                const requests = [];
                for (let childY = 0; childY < childScale; childY++) {
                    for (let childX = 0; childX < childScale; childX++) {
                        const x = coords.x * childScale + childX;
                        const y = coords.y * childScale + childY;
                        requests.push(
                            loadImage(`${baseUrl}/${nativeZoom}/${x}/${y}.png`).then((img) => {
                                if (!img) return;
                                ctx.drawImage(
                                    img,
                                    childX * destinationSize,
                                    childY * destinationSize,
                                    destinationSize,
                                    destinationSize
                                );
                            })
                        );
                    }
                }
                Promise.all(requests).then(() => done(null, tile));
            }
            return tile;
        }
    });

    return Promise.resolve(new RadarTileLayer('', {
        attribution: '気象庁',
        opacity: 0.6,
        minZoom: 2,
        maxZoom: 18,
        radarTime: initialRadarTime
    }));
}

// スライドショー編集モーダルを開く関数
function openEditModal() {
    const modal = document.getElementById('div_slideshow_edit');
    const listElement = document.getElementById('slideshow-edit-list');

    listElement.innerHTML = '';
    const savedCams = Object.keys(slideshowList);

    if (savedCams.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.textContent = '保存されているカメラはありません。';
        listElement.appendChild(emptyItem);
    } else {
        savedCams.forEach(camId => {
            const camName = slideshowList[camId].name;
            const listItem = document.createElement('li');
            const name = document.createElement('span');
            name.textContent = camName;
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-btn';
            deleteButton.type = 'button';
            deleteButton.dataset.camid = camId;
            deleteButton.textContent = '削除';
            listItem.append(name, deleteButton);
            listElement.appendChild(listItem);
        });
    }
    modal.classList.add('display');
}

// カメラをリストから削除する関数
function removeFromSlideshow(camId) {
    if (slideshowList[camId]) {
        delete slideshowList[camId];
        saveSlideshowList();
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

        document.getElementById('slideshow_save_btn').addEventListener('click', () => {
            const slideshowIds = Object.keys(slideshowList);
            if (slideshowIds.length === 0) {
                alert('保存するカメラがありません。\nマップ上のカメラをクリックして「スライドショーに保存」にチェックを入れてください。');
                return;
            }
            // 履歴書き出しサーバー側でカメラIDを検証する。URLが長くなりすぎないようIDのみ渡す。
            const url = `https://rivercamdlsystem.ikunocam.net/slideshow-export.html?cams=${encodeURIComponent(slideshowIds.join(','))}`;
            window.open(url, '_blank', 'noopener');
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
            saveSlideshowList();
        });

        document.getElementById('close_photoModal').addEventListener('click', () => {
            document.getElementById('photoModal').classList.remove('display');
        });

        document.getElementById('river_refresh_btn').addEventListener('click', () => {
            lastGaugeRequestKey = '';
            loadRiverWarnings(true);
            loadWaterGauges(true);
        });

        document.getElementById('close_waterLevelModal').addEventListener('click', closeWaterLevelModal);
        document.getElementById('water-level-retry').addEventListener('click', () => {
            if (selectedGaugeId) openWaterLevelModal(selectedGaugeId);
        });

        document.querySelectorAll('.range-tab').forEach((button) => {
            button.addEventListener('click', () => {
                selectedGraphHours = Number(button.dataset.hours) === 72 ? 72 : 24;
                updateRangeTabs();
                if (selectedGaugeData) renderWaterLevelChart(selectedGaugeData, selectedGraphHours);
            });
        });

        document.querySelectorAll('.modal').forEach((modal) => {
            modal.addEventListener('click', (event) => {
                if (event.target !== modal) return;
                if (modal.id === 'waterLevelModal') closeWaterLevelModal();
                else modal.classList.remove('display');
            });
        });

        document.getElementById('waterLevelModal').addEventListener('keydown', (event) => {
            if (event.key !== 'Tab') return;
            const focusable = Array.from(event.currentTarget.querySelectorAll('button:not(:disabled), [href], input:not(:disabled)'))
                .filter((element) => !element.closest('[hidden]'));
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (document.getElementById('waterLevelModal').classList.contains('display')) {
                closeWaterLevelModal();
            }
            document.querySelectorAll('.modal.display').forEach((modal) => modal.classList.remove('display'));
        });

        let resizeTimer;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (selectedGaugeData && document.getElementById('waterLevelModal').classList.contains('display')) {
                    renderWaterLevelChart(selectedGaugeData, selectedGraphHours);
                }
            }, 150);
        });

    } catch (error) {
        console.error('初期化中にエラーが発生しました:', error);
    }
});

class CameraCache {
    constructor() {
        this.store = appStorage;
        this.prefix = 'riverCam_json_';
        this.version = 1;
        this.expiration = 28 * 24 * 60 * 60 * 1000;
    }
    _key(id) { return `${this.prefix}${id}`; }
    _isValid(data) {
        return data && data.version === this.version && (new Date().getTime() - data.timestamp) < this.expiration;
    }
    set(id, value) {
        try {
            const data = { version: this.version, timestamp: new Date().getTime(), value: value };
            this.store.setItem(this._key(id), JSON.stringify(data));
        } catch (e) {
            if (e.name === 'QuotaExceededError') {
                // Silently fail if storage quota is exceeded
                return;
            }
            throw e;
        }
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

function getLatLngFromPoint(point) {
    if (!point || !hasNumericValue(point.lat) || !hasNumericValue(point.lng)) return null;
    return { lat: Number(point.lat), lng: Number(point.lng) };
}

function getDistanceMeters(leftPoint, rightPoint) {
    const left = getLatLngFromPoint(leftPoint);
    const right = getLatLngFromPoint(rightPoint);
    if (!left || !right) return Infinity;
    const radius = 6371008.8;
    const toRadians = (degrees) => degrees * Math.PI / 180;
    const dLat = toRadians(right.lat - left.lat);
    const dLng = toRadians(right.lng - left.lng);
    const lat1 = toRadians(left.lat);
    const lat2 = toRadians(right.lat);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearbyWaterGauge(camera) {
    let nearest = null;
    let nearestDistance = SAME_LOCATION_DISTANCE_METERS;
    forEachNearbySpatialItem(waterGaugeSpatialIndex, camera, (station) => {
        const distance = getDistanceMeters(camera, station);
        if (distance <= nearestDistance) {
            nearest = station;
            nearestDistance = distance;
        }
    });
    return nearest;
}

function findNearbyCamera(station) {
    let nearest = null;
    let nearestDistance = SAME_LOCATION_DISTANCE_METERS;
    forEachNearbySpatialItem(cameraSpatialIndex, station, (camera) => {
        const distance = getDistanceMeters(station, camera);
        if (distance <= nearestDistance) {
            nearest = camera;
            nearestDistance = distance;
        }
    });
    return nearest;
}

function spatialCellKey(lat, lng) {
    return `${Math.floor(Number(lat) / SPATIAL_CELL_SIZE)}:${Math.floor(Number(lng) / SPATIAL_CELL_SIZE)}`;
}

function buildSpatialIndex(items, getItem = (item) => item) {
    const index = new Map();
    items.forEach((item) => {
        const value = getItem(item);
        if (!value || !hasNumericValue(value.lat) || !hasNumericValue(value.lng)) return;
        const key = spatialCellKey(value.lat, value.lng);
        const bucket = index.get(key);
        if (bucket) bucket.push(value);
        else index.set(key, [value]);
    });
    return index;
}

function forEachNearbySpatialItem(index, point, callback) {
    if (!point || !hasNumericValue(point.lat) || !hasNumericValue(point.lng)) return;
    const row = Math.floor(Number(point.lat) / SPATIAL_CELL_SIZE);
    const column = Math.floor(Number(point.lng) / SPATIAL_CELL_SIZE);
    for (let latOffset = -1; latOffset <= 1; latOffset += 1) {
        for (let lngOffset = -1; lngOffset <= 1; lngOffset += 1) {
            const bucket = index.get(`${row + latOffset}:${column + lngOffset}`);
            if (bucket) bucket.forEach(callback);
        }
    }
}

function createCameraIcon(hasGauge = false) {
    return L.divIcon({
        className: 'camera-div-icon',
        html: `<div class="camera-marker${hasGauge ? ' has-gauge' : ''}"><span class="camera-marker-lens"></span></div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        tooltipAnchor: [0, -20],
    });
}

function getCameraImageTime(item) {
    if (!item || typeof item !== 'object') return '';
    return item.arcTime || item.provTime || item.obsTime || item.time || item.date || item.datetime || '';
}

function formatCameraImageTime(value) {
    if (!value) return '';
    const text = String(value);
    const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(text);
    if (compact) {
        return `${compact[1]}/${compact[2]}/${compact[3]} ${compact[4]}:${compact[5]}`;
    }
    const timestamp = Date.parse(text.replace(/\//g, '-'));
    if (!Number.isFinite(timestamp)) return text;
    return new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
    }).format(new Date(timestamp));
}

function parseCameraImageTime(value) {
    if (!value) return NaN;
    const text = String(value);
    const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?$/.exec(text);
    if (compact) {
        return new Date(
            Number(compact[1]), Number(compact[2]) - 1, Number(compact[3]),
            Number(compact[4]), Number(compact[5]), Number(compact[6] || 0)
        ).getTime();
    }
    return Date.parse(text.replace(/\//g, '-'));
}

function getPastCameraImage(camInfo, currentUrl) {
    const obsInfo = camInfo?.obsInfo || {};
    const normalUrl = obsInfo.normProvUrl || obsInfo.normallyUrl
        || camInfo?.normProvUrl || camInfo?.normallyUrl;
    if (normalUrl && normalUrl !== currentUrl) {
        return {
            arcUrl: normalUrl,
            arcTime: obsInfo.normProvTime || obsInfo.normallyTime
                || camInfo?.normProvTime || camInfo?.normallyTime || '',
            isNormal: true,
        };
    }

    const archiveSources = [camInfo?.archiveList, obsInfo.archiveList];
    const archives = archiveSources
        .filter(Array.isArray)
        .flat()
        .filter((item) => item?.arcUrl && item.arcUrl !== currentUrl);
    if (archives.length === 0) return null;
    const dated = archives.map((item, index) => ({
        item,
        index,
        timestamp: parseCameraImageTime(getCameraImageTime(item)),
    }));
    dated.sort((left, right) => {
        if (Number.isFinite(left.timestamp) && Number.isFinite(right.timestamp)) {
            return left.timestamp - right.timestamp;
        }
        if (Number.isFinite(left.timestamp)) return -1;
        if (Number.isFinite(right.timestamp)) return 1;
        return right.index - left.index;
    });
    return dated[0].item;
}

async function openCameraModal(camId, camera) {
    const currentImage = document.getElementById('photoModal_photo_img');
    const pastImage = document.getElementById('photoModal_past_img');
    const pastItem = document.getElementById('photo-past-item');
    const comparison = document.getElementById('photo-comparison');
    const comparisonNote = document.getElementById('photo-comparison-note');
    try {
        document.getElementById('photoModal_photo_name').innerText = camera.name;
        currentImage.src = 'https://placehold.jp/640x480.png?text=Loading...';
        document.getElementById('photo-current-time').textContent = '';
        document.getElementById('photo-past-time').textContent = '';
        pastItem.hidden = true;
        comparisonNote.hidden = true;
        comparison.classList.add('is-current-only');
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
            currentImage.src = imageUrl;
            document.getElementById('photo-current-time').textContent = formatCameraImageTime(
                getCameraImageTime(camInfo.obsInfo) || getCameraImageTime(camInfo)
            );
            const past = getPastCameraImage(camInfo, imageUrl);
            if (past) {
                pastImage.src = past.arcUrl;
                document.getElementById('photo-past-time').textContent = formatCameraImageTime(getCameraImageTime(past));
                document.querySelector('#photo-past-item strong').textContent = past.isNormal
                    ? '平常時'
                    : '過去（平常時の参考）';
                comparisonNote.hidden = !!past.isNormal;
                pastItem.hidden = false;
                comparison.classList.remove('is-current-only');
            }
        } else {
            throw new Error('image not found');
        }
    } catch (error) {
        console.error(`camera image load failed (${camId})`, error);
        currentImage.src = 'https://placehold.jp/640x480.png?text=Error';
    }
}

function openSameLocationChoicePopup(anchor, camera, station) {
    if (!map || !camera || !station) return;
    const popup = document.createElement('div');
    popup.className = 'same-location-popup';

    const title = document.createElement('strong');
    title.textContent = '\u540c\u3058\u5834\u6240\u306b\u3042\u308a\u307e\u3059';

    const question = document.createElement('p');
    question.textContent = '\u3069\u3061\u3089\u3092\u8868\u793a\u3057\u307e\u3059\u304b\uff1f';

    const names = document.createElement('div');
    names.className = 'same-location-names';
    const cameraName = document.createElement('span');
    cameraName.textContent = camera.name || '\u6cb3\u5ddd\u30ab\u30e1\u30e9';
    const stationName = document.createElement('span');
    stationName.textContent = station.name || '\u6c34\u4f4d\u8a08';
    names.append(cameraName, stationName);

    const actions = document.createElement('div');
    actions.className = 'same-location-actions';
    const cameraButton = document.createElement('button');
    cameraButton.type = 'button';
    cameraButton.className = 'same-location-button camera-choice';
    cameraButton.textContent = '\u6cb3\u5ddd\u30ab\u30e1\u30e9';
    const gaugeButton = document.createElement('button');
    gaugeButton.type = 'button';
    gaugeButton.className = 'same-location-button gauge-choice';
    gaugeButton.textContent = '\u6c34\u4f4d\u8a08';
    actions.append(cameraButton, gaugeButton);
    popup.append(title, question, names, actions);

    const latLng = typeof anchor.getLatLng === 'function'
        ? anchor.getLatLng()
        : L.latLng(Number(camera.lat), Number(camera.lng));
    L.popup({ maxWidth: 300, className: 'same-location-leaflet-popup' })
        .setLatLng(latLng)
        .setContent(popup)
        .openOn(map);

    cameraButton.addEventListener('click', () => {
        map.closePopup();
        openCameraModal(camera.id, camera);
    });
    gaugeButton.addEventListener('click', () => {
        map.closePopup();
        openWaterLevelModal(station.id);
    });
}

function drawMap() {
    if (!markers) return;
    const renderSequence = ++cameraRenderSequence;
    const cameras = Object.entries(pointLatLngList);
    markers.clearLayers();
    const addBatch = (start) => {
        if (renderSequence !== cameraRenderSequence) return;
        const newMarkers = [];
        const end = Math.min(start + WATER_GAUGE_RENDER_BATCH_SIZE, cameras.length);
        cameras.slice(start, end).forEach(([camId, camera]) => {
        const latlon = new L.LatLng(camera.lat, camera.lng);
        const cameraTooltip = document.createElement('span');
        cameraTooltip.textContent = camera.name;
        const nearbyGauge = findNearbyWaterGauge(camera);
        const kariMarker = L.marker(latlon, {
            icon: createCameraIcon(!!nearbyGauge),
            title: camera.name,
            riseOnHover: true,
        }).bindTooltip(cameraTooltip);

        kariMarker.on('click', () => {
            const matchingGauge = findNearbyWaterGauge(camera);
            if (matchingGauge) {
                openSameLocationChoicePopup(kariMarker, { id: camId, ...camera }, matchingGauge);
                return;
            }
            openCameraModal(camId, camera);
        });
        newMarkers.push(kariMarker);
        });
        markers.addLayers(newMarkers);
        if (end < cameras.length) setTimeout(() => addBatch(end), 0);
    };
    addBatch(0);
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

async function fetchWithTimeout(url, timeoutMilliseconds = 10000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function loadCameraFile(file) {
    const cachedData = cameraCache.get(file);
    if (Array.isArray(cachedData)) {
        cachedData.forEach((camera) => {
            if (!camera || camera.id === undefined) return;
            pointLatLngList[camera.id] = { name: camera.name, lat: camera.lat, lng: camera.lng };
        });
        return;
    }
    if (cachedData !== null) cameraCache.remove(file);

    if (typeof file !== 'string' || !/^[A-Za-z0-9_.-]+\.json$/.test(file)) return;
    try {
        const response = await fetchWithTimeout(`cache/${encodeURIComponent(file)}`, 10000);
        if (!response.ok) return;
        const data = await response.json();
        if (!Array.isArray(data.features)) return;

        const cameras = data.features
            .filter((feature) => feature.properties?.id && feature.geometry?.coordinates?.length === 2)
            .map((feature) => ({
                id: feature.properties.id.toString(),
                name: feature.properties.name || '',
                lat: feature.geometry.coordinates[1],
                lng: feature.geometry.coordinates[0],
            }));
        if (cameras.length === 0) return;
        cameraCache.set(file, cameras);
        cameras.forEach((camera) => {
            pointLatLngList[camera.id] = { name: camera.name, lat: camera.lat, lng: camera.lng };
        });
    } catch (error) {
        if (error.name !== 'AbortError') console.debug(`カメラデータを読み込めませんでした: ${file}`);
    }
}

function applyCameraIndex(cameras) {
    if (!Array.isArray(cameras)) return 0;
    let loaded = 0;
    for (const row of cameras) {
        // 転送量削減のため統合indexは [id, name, lat, lng] の配列形式。
        if (!Array.isArray(row) || row.length < 4) continue;
        const [id, name, lat, lng] = row;
        if (id === null || id === undefined || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) continue;
        pointLatLngList[String(id)] = { name: String(name || ''), lat: Number(lat), lng: Number(lng) };
        loaded += 1;
    }
    return loaded;
}

async function loadLegacyCameraFiles() {
    const listResponse = await fetchWithTimeout('json_files_list.json', 12000);
    if (!listResponse.ok) throw new Error('ファイルリストの取得に失敗');
    const fileList = await listResponse.json();
    const files = Array.isArray(fileList.files) ? fileList.files : [];
    const total = files.length;
    let done = 0;
    let nextIndex = 0;
    updateLoadingProgress(done, total);

    const worker = async () => {
        while (nextIndex < total) {
            const file = files[nextIndex++];
            await loadCameraFile(file);
            done += 1;
            if (done === total || done % 20 === 0) updateLoadingProgress(done, total);
        }
    };
    // HTTP/2でも大量の小さいJSONは遅いため、fallback時は同時数を増やす。
    const workerCount = Math.min(16, Math.max(1, total));
    await Promise.all(Array.from({ length: workerCount }, worker));
}

async function loadAllCameraData() {
    const loader = document.getElementById('loader');

    try {
        // 旧方式は約1,400個のJSONを個別取得していた。静的に統合した軽量indexを
        // 1リクエストで取得し、HTTP往復・JSON.parse・localStorageアクセスを削減する。
        try {
            const indexResponse = await fetchWithTimeout('camera_index.json', 15000);
            if (!indexResponse.ok) throw new Error(`HTTP ${indexResponse.status}`);
            const index = await indexResponse.json();
            const count = applyCameraIndex(index.cameras);
            if (count === 0) throw new Error('統合カメラindexが空です');
            updateLoadingProgress(count, count);
        } catch (indexError) {
            console.warn('統合カメラindexを利用できないため旧方式で取得します:', indexError);
            await loadLegacyCameraFiles();
        }

        cameraSpatialIndex = buildSpatialIndex(Object.entries(pointLatLngList), ([id, camera]) => ({ id, ...camera }));
        drawMap();
        if (visibleWaterGaugeStations.length > 0) {
            renderWaterGaugeMarkers(visibleWaterGaugeStations, false);
        }

    } catch (error) {
        console.error('データ読み込みエラー:', error);
    } finally {
        if (loader) loader.style.display = 'none';
    }
}

function getWaterLevelStyle(source = {}) {
    if (source.missing) {
        return { rank: -2, label: '欠測', color: '#c8c8cb', textColor: '#182230' };
    }
    if (source.thresholdsConfigured === false) {
        return { rank: -1, label: '基準未設定', color: '#ffffff', textColor: '#182230' };
    }
    const level = Number(source.level) || 0;
    return WATER_LEVEL_STYLES.find((style) => level >= style.minimum)
        || WATER_LEVEL_STYLES[WATER_LEVEL_STYLES.length - 1];
}

function hasNumericValue(value) {
    return value !== null && value !== '' && typeof value !== 'boolean' && Number.isFinite(Number(value));
}

function warningColor(properties = {}) {
    const level = Number(properties.level) || 0;
    if (properties.type === 'fldctl') {
        if (level >= 40) return '#faf500';
        if (level >= 20) return '#cbf266';
        return '#35a86b';
    }
    if (level >= 90) return '#140014';
    if (level >= 80) return '#aa00aa';
    if (level >= 60) return '#ff2800';
    return '#f2e700';
}

function styleRiverWarning(feature) {
    const properties = feature?.properties || {};
    return {
        color: warningColor(properties),
        weight: Number(properties.level) >= 80 ? 8 : 7,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
        dashArray: properties.type === 'fldctl' ? '10 7' : null,
    };
}

function bindRiverWarningPopup(feature, layer) {
    const properties = feature?.properties || {};
    const popup = document.createElement('div');
    popup.className = 'river-warning-popup';

    const title = document.createElement('strong');
    title.textContent = properties.name || '警報河川';
    popup.appendChild(title);

    const level = document.createElement('div');
    level.className = 'warning-level';
    level.style.color = warningColor(properties);
    level.textContent = properties.levelLabel || properties.kind || '河川警報';
    popup.appendChild(level);

    if (properties.heading) {
        const heading = document.createElement('p');
        heading.textContent = properties.heading;
        popup.appendChild(heading);
    }
    if (properties.announcedAt) {
        const time = document.createElement('time');
        time.textContent = `${properties.announcedAt} 発表`;
        popup.appendChild(time);
    }

    layer.bindPopup(popup, { maxWidth: 320 });
    const tooltip = document.createElement('span');
    tooltip.textContent = `${properties.name || '警報河川'}（${properties.levelLabel || '警報'}）`;
    layer.bindTooltip(tooltip, {
        sticky: true,
    });
    layer.on('mouseover', () => layer.setStyle({ weight: styleRiverWarning(feature).weight + 3 }));
    layer.on('mouseout', () => riverWarningLayer.resetStyle(layer));
}

function createWaterGaugeIcon(station, hasCamera = false) {
    const style = getWaterLevelStyle(station);
    const darkClass = style.textColor === '#ffffff' ? ' is-dark' : '';
    return L.divIcon({
        className: 'water-gauge-div-icon',
        html: `<div class="water-gauge-marker${darkClass}${hasCamera ? ' has-camera' : ''}" style="--pin-color:${style.color}"><span class="water-gauge-pin"></span></div>`,
        iconSize: [34, 42],
        iconAnchor: [17, 39],
        tooltipAnchor: [0, -34],
    });
}

function createWaterGaugeClusterIcon(cluster) {
    const childMarkers = cluster.getAllChildMarkers();
    let strongest = null;
    childMarkers.forEach((marker) => {
        const style = marker.options.waterLevelStyle;
        if (style && (strongest === null || style.rank > strongest.rank)) strongest = style;
    });
    strongest = strongest || getWaterLevelStyle({ level: 0 });
    return L.divIcon({
        className: 'water-cluster-icon',
        html: `<div class="water-cluster" style="--cluster-color:${strongest.color};--cluster-text:${strongest.textColor}">${childMarkers.length}</div>`,
        iconSize: [38, 38],
    });
}

async function fetchRiverData(parameters, signal) {
    const query = new URLSearchParams();
    Object.entries(parameters).forEach(([key, value]) => query.set(key, String(value)));
    const response = await fetch(`${RIVER_DATA_API}?${query.toString()}`, {
        signal,
        headers: { Accept: 'application/json' },
    });
    let payload;
    try {
        payload = await response.json();
    } catch (error) {
        throw new Error('河川データの応答を読み取れませんでした。');
    }
    if (!response.ok || payload.error) {
        throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload;
}

function isFreshCache(entry) {
    return entry && (Date.now() - entry.timestamp) < RIVER_DATA_CACHE_TTL_MS;
}

function boundsFromLeafletBounds(leafletBounds) {
    return {
        north: Math.min(90, leafletBounds.getNorth()),
        south: Math.max(-90, leafletBounds.getSouth()),
        east: Math.min(180, leafletBounds.getEast()),
        west: Math.max(-180, leafletBounds.getWest()),
    };
}

function boundsContain(outer, inner) {
    const epsilon = 0.000001;
    return outer
        && inner.north <= outer.north + epsilon
        && inner.south >= outer.south - epsilon
        && inner.east <= outer.east + epsilon
        && inner.west >= outer.west - epsilon;
}

function stationInBounds(station, bounds) {
    const lat = Number(station?.lat);
    const lng = Number(station?.lng);
    return Number.isFinite(lat)
        && Number.isFinite(lng)
        && lat <= bounds.north
        && lat >= bounds.south
        && lng <= bounds.east
        && lng >= bounds.west;
}

function cachedGaugeDataFor(overview, bounds) {
    if (!isFreshCache(waterGaugeResponseCache)) return null;
    if (overview) return waterGaugeResponseCache.overview ? waterGaugeResponseCache.data : null;
    if (waterGaugeResponseCache.overview) return null;
    return boundsContain(waterGaugeResponseCache.bounds, bounds)
        ? waterGaugeResponseCache.data
        : null;
}

function renderCachedGaugeData(data, bounds, overview) {
    const stations = Array.isArray(data?.stations) ? data.stations : [];
    renderWaterGaugeMarkers(overview ? stations : stations.filter((station) => stationInBounds(station, bounds)));
    riverLoadState.gauges.updatedAt = data?.updatedAt || riverLoadState.gauges.updatedAt || '';
    updateRiverDataStatus();
}

function applyRiverWarningData(data) {
    const featureCollection = data.geojson || { type: 'FeatureCollection', features: [] };
    if (Array.isArray(featureCollection.features)) {
        featureCollection.features.sort((left, right) =>
            (Number(left?.properties?.level) || 0) - (Number(right?.properties?.level) || 0));
    }
    riverWarningLayer.clearLayers();
    riverWarningLayer.addData(featureCollection);
    riverLoadState.warnings.totalCount = Array.isArray(data.warnings) ? data.warnings.length : 0;
    riverLoadState.warnings.count = hasNumericValue(data.renderedWarningCount)
        ? Number(data.renderedWarningCount)
        : riverLoadState.warnings.totalCount;
    riverLoadState.warnings.updatedAt = data.updatedAt || '';
}

function updateRiverDataStatus() {
    const status = document.getElementById('river-data-status');
    const state = document.getElementById('river-data-state');
    const refresh = document.getElementById('river_refresh_btn');
    if (!status || !state || !refresh) return;

    const isLoading = riverLoadState.gauges.loading || riverLoadState.warnings.loading;
    const hasError = riverLoadState.gauges.error || riverLoadState.warnings.error;
    const warningCountText = riverLoadState.warnings.totalCount > riverLoadState.warnings.count
        ? `警報 ${riverLoadState.warnings.count}/${riverLoadState.warnings.totalCount}件`
        : `警報 ${riverLoadState.warnings.count}件`;
    refresh.disabled = isLoading;
    state.className = `data-state${isLoading ? ' is-loading' : hasError ? ' is-error' : ''}`;
    updateRiverProgress(isLoading);

    if (isLoading) {
        status.textContent = '河川警報・水位計を更新中...';
        return;
    }
    if (hasError) {
        const available = [];
        if (!riverLoadState.warnings.error) available.push(warningCountText);
        if (!riverLoadState.gauges.error) available.push(`水位計 ${riverLoadState.gauges.count}地点`);
        status.textContent = available.length
            ? `${available.join('・')}（一部取得失敗）`
            : '河川情報を取得できません。更新してください。';
        return;
    }

    const updatedAt = riverLoadState.gauges.updatedAt || riverLoadState.warnings.updatedAt;
    const shortTime = updatedAt ? updatedAt.slice(5) : '';
    status.textContent = `${warningCountText}・水位計 ${riverLoadState.gauges.count}地点${shortTime ? `（${shortTime}）` : ''}`;
}

function updateRiverProgress(isLoading = riverLoadState.gauges.loading || riverLoadState.warnings.loading) {
    const progress = document.getElementById('river-progress');
    const bar = document.getElementById('river-progress-bar');
    const percent = document.getElementById('river-progress-percent');
    const text = document.getElementById('river-progress-text');
    const track = progress?.querySelector('[role="progressbar"]');
    if (!progress || !bar || !percent || !text || !track) return;

    const gaugeProgress = riverLoadState.gauges.loading
        ? riverLoadState.gauges.progress
        : 100;
    const warningProgress = riverLoadState.warnings.loading
        ? riverLoadState.warnings.progress
        : 100;
    const value = Math.round((gaugeProgress + warningProgress) / 2);
    const label = riverLoadState.gauges.loading && riverLoadState.warnings.loading
        ? '河川警報・水位計を更新中...'
        : riverLoadState.gauges.loading
            ? '水位計を更新中...'
            : '河川警報を更新中...';

    progress.hidden = !isLoading;
    bar.style.width = `${value}%`;
    percent.textContent = `${value}%`;
    text.textContent = label;
    track.setAttribute('aria-valuenow', String(value));
}

async function loadRiverWarnings(force = false) {
    if (!riverWarningLayer) return;
    if (!force && isFreshCache(riverWarningResponseCache)) {
        applyRiverWarningData(riverWarningResponseCache.data);
        return;
    }
    const requestId = ++warningRequestSequence;
    if (activeWarningController) activeWarningController.abort();
    const controller = new AbortController();
    activeWarningController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, 60000);
    riverLoadState.warnings.loading = true;
    riverLoadState.warnings.progress = 10;
    riverLoadState.warnings.error = '';
    updateRiverDataStatus();

    try {
        const data = await fetchRiverData({ action: 'warnings' }, controller.signal);
        if (requestId !== warningRequestSequence) return;
        riverWarningResponseCache = { timestamp: Date.now(), data };
        riverLoadState.warnings.progress = 80;
        applyRiverWarningData(data);
    } catch (error) {
        if ((error.name !== 'AbortError' || timedOut) && requestId === warningRequestSequence) {
            console.error('河川警報の読み込みに失敗しました:', error);
            riverLoadState.warnings.error = timedOut ? '取得がタイムアウトしました。' : error.message;
        }
    } finally {
        clearTimeout(timeout);
        if (requestId === warningRequestSequence) {
            riverLoadState.warnings.loading = false;
            riverLoadState.warnings.progress = 100;
            if (activeWarningController === controller) activeWarningController = null;
            updateRiverDataStatus();
        }
    }
}

function alignToFiveMinuteInterval() {
    const now = Date.now();
    const next = Math.ceil(now / 300000) * 300000;
    return next - now + 100;
}

async function fetchNationwideGauges() {
    if (fetchingNationwideGauges) return;
    fetchingNationwideGauges = true;
    const seq = ++nationwideGaugeRefreshSeq;
    try {
        const data = await fetchRiverData({ action: 'gauges-all' });
        if (seq !== nationwideGaugeRefreshSeq) return;
        nationwideGaugeCache = { timestamp: Date.now(), data };
        scheduleWaterGaugeLoad(true);
    } catch (error) {
        console.error('全国水位データの取得に失敗しました:', error);
    } finally {
        fetchingNationwideGauges = false;
    }
}

function scheduleNationwideGaugeRefresh() {
    clearTimeout(nationwideGaugeTimer);
    const delay = alignToFiveMinuteInterval();
    nationwideGaugeTimer = setTimeout(() => {
        fetchNationwideGauges();
        nationwideGaugeTimer = setInterval(fetchNationwideGauges, 300000);
    }, delay);
}

function scheduleWaterGaugeLoad(force = false) {
    clearTimeout(waterGaugeLoadTimer);
    const delay = force === true ? 0 : 350;
    waterGaugeLoadTimer = setTimeout(() => {
        waterGaugeLoadTimer = null;
        loadWaterGauges(force === true);
    }, delay);
}

function createWaterGaugeMarker(station) {
    const nearbyCamera = findNearbyCamera(station);
    const levelStyle = getWaterLevelStyle(station);
    const marker = L.marker([Number(station.lat), Number(station.lng)], {
        icon: createWaterGaugeIcon(station, !!nearbyCamera),
        title: station.name || 'water gauge',
        riseOnHover: true,
        waterLevelStyle: levelStyle,
    });
    const tooltip = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = station.name || '\u6c34\u4f4d\u8a08';
    const detail = document.createElement('div');
    detail.textContent = `${levelStyle.label}${station.observedAt ? ` / ${station.observedAt.slice(5)}` : ''}`;
    tooltip.append(title, detail);
    marker.bindTooltip(tooltip, { direction: 'top', offset: [0, -25] });
    marker.on('click', () => {
        const matchingCamera = findNearbyCamera(station);
        if (matchingCamera) {
            openSameLocationChoicePopup(marker, matchingCamera, station);
            return;
        }
        openWaterLevelModal(station.id);
    });
    return marker;
}

function renderWaterGaugeMarkers(stations, redrawCameras = false) {
    if (!waterGaugeLayer) return;
    visibleWaterGaugeStations = (Array.isArray(stations) ? stations : [])
        .filter((station) => hasNumericValue(station.lat) && hasNumericValue(station.lng));
    waterGaugeSpatialIndex = buildSpatialIndex(visibleWaterGaugeStations);
    const renderSequence = ++waterGaugeRenderSequence;
    waterGaugeLayer.clearLayers();
    riverLoadState.gauges.count = visibleWaterGaugeStations.length;

    const addBatch = (start) => {
        if (renderSequence !== waterGaugeRenderSequence) return;
        const end = Math.min(start + WATER_GAUGE_RENDER_BATCH_SIZE, visibleWaterGaugeStations.length);
        const batch = visibleWaterGaugeStations.slice(start, end).map(createWaterGaugeMarker);
        waterGaugeLayer.addLayers(batch);
        if (end < visibleWaterGaugeStations.length) {
            setTimeout(() => addBatch(end), 0);
        } else if (redrawCameras && Object.keys(pointLatLngList).length > 0) {
            setTimeout(drawMap, 0);
        }
    };
    addBatch(0);
}

async function loadWaterGauges(force = false) {
    if (!map || !waterGaugeLayer || !map.hasLayer(waterGaugeLayer)) return;
    const overview = map.getZoom() < WATER_GAUGE_DETAIL_ZOOM;
    const renderBounds = boundsFromLeafletBounds(map.getBounds().pad(WATER_GAUGE_RENDER_PADDING));

    const nationwideData = nationwideGaugeCache?.data;
    const hasCompleteNationwideData = nationwideData
        && Number(nationwideData.failedPrefs || 0) === 0;
    if (isFreshCache(nationwideGaugeCache) && hasCompleteNationwideData) {
        const stations = Array.isArray(nationwideGaugeCache.data.stations) ? nationwideGaugeCache.data.stations : [];
        const filtered = overview
            ? stations.filter((s) => Number(s.level) > 0)
            : stations.filter((s) => stationInBounds(s, renderBounds));
        renderWaterGaugeMarkers(filtered);
        riverLoadState.gauges.progress = 100;
        riverLoadState.gauges.updatedAt = nationwideGaugeCache.data.updatedAt || '';
        riverLoadState.gauges.error = '';
        riverLoadState.gauges.loading = false;
        updateRiverDataStatus();

        const hint = document.getElementById('water-gauge-hint');
        if (hint) {
            if (overview) hint.textContent = '地図を拡大すると、表示範囲内の全水位計を表示します。現在は基準超過地点のみです。';
            else hint.textContent = '表示範囲内の水位計を表示しています。ピンを押すと水位グラフを確認できます。';
        }
        return;
    }

    const fetchBounds = boundsFromLeafletBounds(map.getBounds().pad(WATER_GAUGE_FETCH_PADDING));
    const requestKey = overview
        ? 'overview'
        : `${Math.floor(map.getZoom())}:${renderBounds.north.toFixed(2)}:${renderBounds.south.toFixed(2)}:${renderBounds.east.toFixed(2)}:${renderBounds.west.toFixed(2)}`;

    const cachedData = cachedGaugeDataFor(overview, renderBounds);
    if (!force && requestKey === lastGaugeRequestKey && cachedData) {
        renderCachedGaugeData(cachedData, renderBounds, overview);
        return;
    }
    lastGaugeRequestKey = requestKey;
    if (!force && cachedData) {
        renderCachedGaugeData(cachedData, renderBounds, overview);
        return;
    }

    const requestId = ++gaugeRequestSequence;
    if (activeGaugeController) activeGaugeController.abort();
    const controller = new AbortController();
    activeGaugeController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, 35000);
    riverLoadState.gauges.loading = true;
    riverLoadState.gauges.progress = 10;
    riverLoadState.gauges.error = '';
    updateRiverDataStatus();

    const parameters = overview
        ? { action: 'gauges', overview: 1 }
        : { action: 'gauges', ...fetchBounds };

    try {
        const data = await fetchRiverData(parameters, controller.signal);
        if (requestId !== gaugeRequestSequence) return;
        waterGaugeResponseCache = {
            timestamp: Date.now(),
            overview,
            bounds: overview ? null : fetchBounds,
            data,
        };
        renderCachedGaugeData(data, renderBounds, overview);
        riverLoadState.gauges.progress = 80;
        riverLoadState.gauges.updatedAt = data.updatedAt || '';

        const hint = document.getElementById('water-gauge-hint');
        if (hint) {
            if (overview) hint.textContent = '地図を拡大すると、表示範囲内の全水位計を表示します。現在は基準超過地点のみです。';
            else if (data.tooWide) hint.textContent = '表示範囲が広いため一部のみです。さらに拡大してください。';
            else hint.textContent = '表示範囲内の水位計を表示しています。ピンを押すと水位グラフを確認できます。';
        }
    } catch (error) {
        if ((error.name !== 'AbortError' || timedOut) && requestId === gaugeRequestSequence) {
            console.error('水位計の読み込みに失敗しました:', error);
            riverLoadState.gauges.error = timedOut ? '取得がタイムアウトしました。' : error.message;
            lastGaugeRequestKey = '';
        }
    } finally {
        clearTimeout(timeout);
        if (requestId === gaugeRequestSequence) {
            riverLoadState.gauges.loading = false;
            riverLoadState.gauges.progress = 100;
            if (activeGaugeController === controller) activeGaugeController = null;
            updateRiverDataStatus();
        }
    }
}

async function openWaterLevelModal(stationId) {
    if (!/^\d{5}004\d{5}$/.test(String(stationId))) return;
    selectedGaugeId = String(stationId);
    selectedGaugeData = null;
    selectedGraphHours = 24;
    updateRangeTabs();

    const modal = document.getElementById('waterLevelModal');
    const loading = document.getElementById('water-level-loading');
    const content = document.getElementById('water-level-content');
    const errorBox = document.getElementById('water-level-error');
    if (!modal.classList.contains('display')) waterModalReturnFocus = document.activeElement;
    modal.classList.add('display');
    loading.hidden = false;
    content.hidden = true;
    errorBox.hidden = true;
    document.getElementById('close_waterLevelModal').focus();

    if (activeDetailController) activeDetailController.abort();
    const controller = new AbortController();
    activeDetailController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, 35000);

    try {
        const data = await fetchRiverData({ action: 'gauge-detail', id: selectedGaugeId }, controller.signal);
        if (selectedGaugeId !== String(stationId)) return;
        selectedGaugeData = data;
        loading.hidden = true;
        content.hidden = false;
        populateWaterLevelModal(data);
    } catch (error) {
        if (error.name === 'AbortError' && !timedOut) return;
        console.error('水位グラフの読み込みに失敗しました:', error);
        loading.hidden = true;
        errorBox.hidden = false;
    } finally {
        clearTimeout(timeout);
        if (activeDetailController === controller) activeDetailController = null;
    }
}

function closeWaterLevelModal() {
    document.getElementById('waterLevelModal').classList.remove('display');
    if (activeDetailController) activeDetailController.abort();
    activeDetailController = null;
    selectedGaugeData = null;
    selectedGaugeId = '';
    if (waterModalReturnFocus && typeof waterModalReturnFocus.focus === 'function') {
        waterModalReturnFocus.focus();
    }
    waterModalReturnFocus = null;
}

function updateRangeTabs() {
    document.querySelectorAll('.range-tab').forEach((button) => {
        const isActive = Number(button.dataset.hours) === selectedGraphHours;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-selected', String(isActive));
        button.tabIndex = isActive ? 0 : -1;
    });
}

function populateWaterLevelModal(data) {
    const station = data.station || {};
    const current = data.current || {};
    const thresholds = Array.isArray(data.thresholds) ? data.thresholds : [];
    const thresholdsConfigured = thresholds.some((threshold) => hasNumericValue(threshold.value))
        || Number(current.level) > 0;
    const style = getWaterLevelStyle({ ...current, thresholdsConfigured });
    const riverNames = [station.riverSystem ? `${station.riverSystem}水系` : '', station.river || '']
        .filter(Boolean)
        .join('・');

    document.getElementById('water-level-river').textContent = riverNames || '河川水位観測所';
    document.getElementById('water-level-title').textContent = station.name || '水位観測所';
    document.getElementById('water-level-current').textContent = hasNumericValue(current.value)
        ? Number(current.value).toFixed(2)
        : '--';
    document.getElementById('water-level-observed-at').textContent = current.observedAt
        ? `${current.observedAt} 観測`
        : '観測時刻不明';
    document.getElementById('water-level-address').textContent = station.address || '情報なし';
    document.getElementById('water-level-office').textContent = station.office || '情報なし';

    const badge = document.getElementById('water-level-badge');
    badge.textContent = style.label;
    badge.style.backgroundColor = style.color;
    badge.style.color = style.textColor;

    renderThresholdList(thresholds);
    renderWaterLevelChart(data, selectedGraphHours);
}

function renderThresholdList(thresholds) {
    const container = document.getElementById('water-threshold-list');
    container.replaceChildren();
    thresholds.filter((threshold) => hasNumericValue(threshold.value)).forEach((threshold) => {
        const item = document.createElement('span');
        const line = document.createElement('i');
        line.style.setProperty('--threshold-color', threshold.color || '#607d8b');
        const label = document.createTextNode(`${threshold.label} ${Number(threshold.value).toFixed(2)}m`);
        item.append(line, label);
        container.appendChild(item);
    });
    if (!container.childElementCount) container.textContent = '基準水位は設定されていません。';
}

function parseMlitTime(value) {
    const match = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return NaN;
    return Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]) - 9,
        Number(match[5])
    );
}

function formatJapanChartTime(timestamp, includeDate = true) {
    const options = includeDate
        ? { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit' }
        : { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' };
    return new Intl.DateTimeFormat('ja-JP', options).format(new Date(timestamp));
}

function svgElement(name, attributes = {}, text = '') {
    const element = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    if (text) element.textContent = text;
    return element;
}

function renderWaterLevelChart(data, hours) {
    const container = document.getElementById('water-chart');
    const summary = document.getElementById('water-chart-summary');
    container.replaceChildren();

    const rawPoints = Array.isArray(data.series) ? data.series : [];
    const normalized = rawPoints
        .filter((point) => hasNumericValue(point.value))
        .map((point) => ({
            time: parseMlitTime(point.time),
            value: Number(point.value),
            intervalMinutes: Number(point.intervalMinutes) === 10 ? 10 : 60,
        }))
        .filter((point) => Number.isFinite(point.time))
        .sort((left, right) => left.time - right.time);
    const currentTime = parseMlitTime(data.current?.observedAt);
    const endTime = Number.isFinite(currentTime)
        ? currentTime
        : normalized.length ? normalized[normalized.length - 1].time : NaN;
    const startTime = endTime - hours * 60 * 60 * 1000;
    const points = normalized.filter((point) => point.time >= startTime && point.time <= endTime);

    if (!Number.isFinite(endTime) || points.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'water-level-loading';
        empty.textContent = 'この期間の有効な水位データはありません。';
        container.appendChild(empty);
        summary.textContent = '';
        return;
    }

    const thresholds = (Array.isArray(data.thresholds) ? data.thresholds : [])
        .filter((threshold) => hasNumericValue(threshold.value))
        .map((threshold) => ({ ...threshold, value: Number(threshold.value) }));
    const values = points.map((point) => point.value).concat(thresholds.map((threshold) => threshold.value));
    let minimum = Math.min(...values);
    let maximum = Math.max(...values);
    if (minimum === maximum) {
        minimum -= 0.5;
        maximum += 0.5;
    } else {
        const padding = Math.max((maximum - minimum) * 0.1, 0.08);
        minimum -= padding;
        maximum += padding;
    }

    const width = Math.max(340, Math.round(container.clientWidth || 760));
    const height = width < 520 ? 250 : 290;
    const margin = { top: 16, right: 18, bottom: 39, left: 54 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const x = (time) => margin.left + ((time - startTime) / (endTime - startTime)) * plotWidth;
    const y = (value) => margin.top + ((maximum - value) / (maximum - minimum)) * plotHeight;

    const svg = svgElement('svg', {
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-labelledby': 'water-chart-svg-title',
        preserveAspectRatio: 'xMidYMid meet',
    });
    svg.appendChild(svgElement('title', { id: 'water-chart-svg-title' }, `${hours === 24 ? '1日' : '3日'}の水位推移`));

    const defs = svgElement('defs');
    const gradient = svgElement('linearGradient', { id: 'water-area-gradient', x1: '0', y1: '0', x2: '0', y2: '1' });
    gradient.append(
        svgElement('stop', { offset: '0%', 'stop-color': '#199ad3', 'stop-opacity': '0.34' }),
        svgElement('stop', { offset: '100%', 'stop-color': '#199ad3', 'stop-opacity': '0.03' })
    );
    defs.appendChild(gradient);
    svg.appendChild(defs);

    for (let index = 0; index <= 4; index++) {
        const value = maximum - ((maximum - minimum) * index / 4);
        const position = y(value);
        svg.appendChild(svgElement('line', {
            x1: margin.left,
            y1: position,
            x2: width - margin.right,
            y2: position,
            class: 'chart-grid-line',
        }));
        svg.appendChild(svgElement('text', {
            x: margin.left - 8,
            y: position + 4,
            'text-anchor': 'end',
            class: 'chart-axis-label',
        }, value.toFixed(2)));
    }
    svg.appendChild(svgElement('text', {
        x: 11,
        y: 14,
        class: 'chart-axis-label',
    }, '水位 (m)'));

    const compactChart = width < 520;
    const tickCount = hours === 72 ? (compactChart ? 3 : 6) : (compactChart ? 3 : 4);
    for (let index = 0; index <= tickCount; index++) {
        const timestamp = startTime + ((endTime - startTime) * index / tickCount);
        const position = x(timestamp);
        svg.appendChild(svgElement('line', {
            x1: position,
            y1: margin.top,
            x2: position,
            y2: height - margin.bottom,
            class: 'chart-grid-line',
        }));
        svg.appendChild(svgElement('text', {
            x: position,
            y: height - 14,
            'text-anchor': index === 0 ? 'start' : index === tickCount ? 'end' : 'middle',
            class: 'chart-axis-label',
        }, formatJapanChartTime(timestamp, true)));
    }

    thresholds.forEach((threshold) => {
        const line = svgElement('line', {
            x1: margin.left,
            y1: y(threshold.value),
            x2: width - margin.right,
            y2: y(threshold.value),
            stroke: threshold.color || '#607d8b',
            class: 'chart-threshold-line',
        });
        line.appendChild(svgElement('title', {}, `${threshold.label} ${threshold.value.toFixed(2)}m`));
        svg.appendChild(line);
    });

    const segments = [];
    let currentSegment = [];
    points.forEach((point, index) => {
        if (index > 0 && point.time - points[index - 1].time > 2.1 * 60 * 60 * 1000) {
            if (currentSegment.length) segments.push(currentSegment);
            currentSegment = [];
        }
        currentSegment.push(point);
    });
    if (currentSegment.length) segments.push(currentSegment);

    segments.forEach((segment) => {
        const lineCommands = segment.map((point, index) =>
            `${index === 0 ? 'M' : 'L'} ${x(point.time).toFixed(2)} ${y(point.value).toFixed(2)}`);
        if (segment.length > 1) {
            const areaCommands = [
                `M ${x(segment[0].time).toFixed(2)} ${(height - margin.bottom).toFixed(2)}`,
                ...lineCommands.map((command, index) => index === 0 ? command.replace(/^M/, 'L') : command),
                `L ${x(segment[segment.length - 1].time).toFixed(2)} ${(height - margin.bottom).toFixed(2)}`,
                'Z',
            ];
            svg.appendChild(svgElement('path', { d: areaCommands.join(' '), class: 'chart-water-area' }));
        }
        svg.appendChild(svgElement('path', { d: lineCommands.join(' '), class: 'chart-water-line' }));
    });

    const pointStep = hours === 72 ? 3 : 1;
    points.forEach((point, index) => {
        if (index % pointStep !== 0 && index !== points.length - 1) return;
        const circle = svgElement('circle', {
            cx: x(point.time),
            cy: y(point.value),
            r: hours === 72 ? 2.2 : 2.7,
            class: 'chart-water-point',
        });
        circle.appendChild(svgElement('title', {}, `${formatJapanChartTime(point.time)} ${point.value.toFixed(2)}m`));
        svg.appendChild(circle);
    });

    container.appendChild(svg);
    const pointMinimum = Math.min(...points.map((point) => point.value));
    const pointMaximum = Math.max(...points.map((point) => point.value));
    const latest = points[points.length - 1];
    const tenMinuteCount = points.filter((point) => point.intervalMinutes === 10).length;
    const intervalText = tenMinuteCount > 0 ? `・10分値 ${tenMinuteCount}点` : '';
    summary.textContent = `${points.length}点を表示${intervalText}・最低 ${pointMinimum.toFixed(2)}m・最高 ${pointMaximum.toFixed(2)}m・最新 ${latest.value.toFixed(2)}m`;
    container.setAttribute('aria-label', `${hours === 24 ? '1日' : '3日'}の水位グラフ。最低${pointMinimum.toFixed(2)}メートル、最高${pointMaximum.toFixed(2)}メートル。`);
}
