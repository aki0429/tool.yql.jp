const JAPAN_GEOJSON_URL = '../../Telop/japan.geojson'; // 環境に合わせてパスを修正してください
const STATION_POINTS_URL = 'intensity-points-v1.json'; // 環境に合わせてパスを修正してください
const IMAGE_POLL_INTERVAL_MS = 1000;
const EEW_POLL_INTERVAL_MS = 1000;
const HOME_CENTER = [36.0, 138.0];
const HOME_ZOOM = 5;

// 公式のスケール画像URLマップ
const LEGEND_URLS = {
    jma_s: 'https://www.lmoni.bosai.go.jp/monitor/data/data/map_img/ScaleImg2/nied_jma_s_w_scale.png',
    acmap_s: 'https://www.lmoni.bosai.go.jp/monitor/data/data/map_img/ScaleImg2/nied_acmap_s_w_scale.png',
    abrspmx_s: 'https://www.lmoni.bosai.go.jp/monitor/data/data/map_img/ScaleImg2/nied_abrspmx_s_w_scale.png'
};

let currentImageType = 'jma_s';
let homeBounds = null;

const loadingOverlay = document.getElementById('loading-overlay');
const lastUpdatedElement = document.getElementById('last-updated');
const dataTimestampElement = document.getElementById('data-timestamp');
const eewBox = document.getElementById('eew-box');
const eewStatusElement = document.getElementById('eew-status');
const eewSummaryElement = document.getElementById('eew-summary');
const eewDetailsElement = document.getElementById('eew-details');
const eewMetaElement = document.getElementById('eew-meta');
const layerIntensityBtn = document.getElementById('layer-intensity');
const layerAccelerationBtn = document.getElementById('layer-acceleration');
const layerAbrspmxBtn = document.getElementById('layer-abrspmx');
const homeBtn = document.getElementById('home-button');

let map;
let japanLayer;
let stationLayer;
let stations = [];
let imagePollTimer;
let eewPollTimer;

document.addEventListener('DOMContentLoaded', initialize);
layerIntensityBtn.addEventListener('click', () => switchLayer('jma_s'));
layerAccelerationBtn.addEventListener('click', () => switchLayer('acmap_s'));
layerAbrspmxBtn.addEventListener('click', () => switchLayer('abrspmx_s'));
homeBtn.addEventListener('click', goHome);

window.addEventListener('beforeunload', () => {
    if (imagePollTimer) clearInterval(imagePollTimer);
    if (eewPollTimer) clearInterval(eewPollTimer);
});

async function initialize() {
    // ローディング表示
    loadingOverlay.classList.remove('hidden');

    map = L.map('map', {
        center: HOME_CENTER,
        zoom: HOME_ZOOM,
        zoomControl: false,
        attributionControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    stationLayer = L.geoJSON(null, { pointToLayer: createStationPoint }).addTo(map);
    
    // 凡例の初期化
    addLegend();

    try {
        const [japanGeoJson, stationData] = await Promise.all([
            fetchJson(JAPAN_GEOJSON_URL, { cache: 'force-cache' }),
            fetchJson(STATION_POINTS_URL, { cache: 'force-cache' }),
        ]);

        stations = normalizeStations(stationData);
        japanLayer = L.geoJSON(japanGeoJson, {
            style: {
                color: '#4f6b83',
                fillColor: '#132437',
                fillOpacity: 0.88,
                opacity: 0.9,
                weight: 0.7,
            },
        }).addTo(map);
        
        homeBounds = japanLayer.getBounds();
        map.fitBounds(homeBounds, { padding: [24, 24] });
        drawStations(stations.map(station => ({ ...station, color: '#64748b', active: false })));

        // プロキシの死活監視
        const [imageProxyReady, eewProxyReady] = await Promise.all([
            probeProxy(getImageProxyUrl()),
            probeProxy('kmoni-eew.php'),
        ]);

        if (imageProxyReady) {
            await updateFromKmoniImage();
            imagePollTimer = setInterval(() => {
                void updateFromKmoniImage();
            }, IMAGE_POLL_INTERVAL_MS);
        } else {
            setStatus('image proxy unavailable');
        }

        if (eewProxyReady) {
            await updateEew();
            eewPollTimer = setInterval(() => {
                void updateEew();
            }, EEW_POLL_INTERVAL_MS);
        } else {
            renderEewState({ active: false });
        }
    } catch (error) {
        setError(error.message);
    } finally {
        loadingOverlay.classList.add('hidden');
        updateLocalTime();
    }
}

function getImageProxyUrl() {
    return `kmoni-image.php?type=${currentImageType}`;
}

function switchLayer(type) {
    if (currentImageType === type) return;
    currentImageType = type;
    updateLayerButtons();
    updateLegend();
    void updateFromKmoniImage();
}

function updateLayerButtons() {
    const activeClass = 'px-3 py-1 bg-blue-600 text-white text-xs rounded font-semibold hover:bg-blue-700';
    const inactiveClass = 'px-3 py-1 bg-gray-400 text-white text-xs rounded font-semibold hover:bg-gray-500';
    
    layerIntensityBtn.className = currentImageType === 'jma_s' ? activeClass : inactiveClass;
    layerAccelerationBtn.className = currentImageType === 'acmap_s' ? activeClass : inactiveClass;
    layerAbrspmxBtn.className = currentImageType === 'abrspmx_s' ? activeClass : inactiveClass;
}

function goHome() {
    if (homeBounds) {
        map.fitBounds(homeBounds, { padding: [24, 24] });
    } else {
        map.setView(HOME_CENTER, HOME_ZOOM);
    }
}

/* =========================================
   ご提示いただいた防災科研のスケール画像を表示する処理
========================================= */
function addLegend() {
    const legend = document.createElement('div');
    legend.id = 'map-legend';
    legend.className = 'map-legend'; // HTML側のCSSクラスを適用
    document.body.appendChild(legend);
    updateLegend();
}

function updateLegend() {
    const legendElement = document.getElementById('map-legend');
    if (!legendElement) return;

    const imgSrc = LEGEND_URLS[currentImageType];
    let title = '';

    if (currentImageType === 'jma_s') title = 'リアルタイム震度';
    else if (currentImageType === 'acmap_s') title = '最大加速度 (PGA)';
    else if (currentImageType === 'abrspmx_s') title = '絶対速度応答スペクトル';

    // 背景が透過されている画像を見やすくするため、白背景（bg-white）とパディングを付与
    legendElement.innerHTML = `
        <div style="margin-bottom: 5px; font-weight: bold; text-align: center;">${title}</div>
        <img src="${imgSrc}" alt="${title}" style="max-height: 250px; width: auto; background-color: #ffffff; padding: 4px; border-radius: 4px;">
    `;
}

/* =========================================
   画像取得とCanvasによるピクセル解析処理
========================================= */
async function updateFromKmoniImage() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(addCacheBust(getImageProxyUrl()), {
            cache: 'no-store',
            signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (!response.ok) throw new Error(`KMoni image ${response.status}`);

        const blob = await response.blob();
        const image = await createImageBitmap(blob);
        const timestamp = response.headers.get('X-Kmoni-Time') || '';

        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);

        const coloredStations = stations.map(station => {
            const { r, g, b, a } = readPixel(context, station.point.x, station.point.y, image.width, image.height);
            const active = a > 0 && !isBackgroundColor(r, g, b);
            const label = active ? getValueLabel(r, g, b, currentImageType) : '';

            return {
                ...station,
                color: active ? `rgb(${r}, ${g}, ${b})` : '#334155',
                active,
                label,
            };
        });

        drawStations(coloredStations);
        setStatus(timestamp ? formatTimestamp(timestamp) : 'latest image');
        updateLocalTime();
    } catch (error) {
        setStatus(`待機中... (${error.message})`);
    }
}

async function updateEew() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(addCacheBust('kmoni-eew.php'), { cache: 'no-store', signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.status === 204) {
            renderEewState({ active: false });
            return;
        }
        if (!response.ok) throw new Error(`KMoni EEW ${response.status}`);

        const data = await response.json();
        const payload = data.data || data.payload || data;
        const eew = normalizeEew(payload);
        
        if (!eew.isActive) {
            renderEewState({ active: false });
            return;
        }

        const summary = buildEewSummary(eew);
        const metaParts = [];
        if (eew.requestTime) metaParts.push(`リクエスト ${formatTimestamp(eew.requestTime)}`);
        if (eew.isFinal !== null) metaParts.push(eew.isFinal ? '最終報' : '速報');

        renderEewState({
            active: true,
            title: summary.title,
            summary: summary.summary,
            details: buildEewDetails(eew),
            meta: metaParts.join(' / '),
        });
    } catch (error) {
        renderEewState({ active: false });
    }
}

function renderEewState({ active = true, title, summary, details, meta }) {
    if (!active) {
        eewBox.classList.add('hidden');
        return;
    }

    eewBox.classList.remove('hidden');
    eewStatusElement.textContent = title || 'EEW発表中';
    eewSummaryElement.textContent = summary || '詳細情報を取得中';
    eewDetailsElement.innerHTML = details ? details.split('\n').map(escapeHtml).join('<br>') : '';
    eewMetaElement.textContent = meta || '';
}

function setStatus(message) {
    dataTimestampElement.textContent = message;
}

function setError(message) {
    dataTimestampElement.innerHTML = `<span class="text-red-600 font-bold">${escapeHtml(message)}</span>`;
}

function updateLocalTime() {
    lastUpdatedElement.textContent = new Date().toLocaleTimeString('ja-JP');
}

function formatTimestamp(value) {
    const raw = String(value || '');
    if (!/^\d{14}$/.test(raw)) return raw;

    const year = raw.slice(0, 4);
    const month = raw.slice(4, 6);
    const day = raw.slice(6, 8);
    const hour = raw.slice(8, 10);
    const minute = raw.slice(10, 12);
    const second = raw.slice(12, 14);
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

async function fetchJson(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`${url} ${response.status}`);
    return response.json();
}

async function probeProxy(url) {
    try {
        const response = await fetch(addQuery(url, 'ping=1'), { cache: 'no-store' });
        return response.status === 204;
    } catch {
        return false;
    }
}

function addQuery(url, query) {
    return url.includes('?') ? `${url}&${query}` : `${url}?${query}`;
}

function addCacheBust(url) {
    return addQuery(url, `t=${Date.now()}`);
}

function normalizeStations(stationData) {
    if (!Array.isArray(stationData)) return [];
    return stationData.filter(station => {
        return station && !station.IsSuspended && station.Location && station.Point
            && Number.isFinite(Number(station.Location.latitude))
            && Number.isFinite(Number(station.Location.longitude))
            && Number.isFinite(Number(station.Point.x))
            && Number.isFinite(Number(station.Point.y));
    }).map(station => ({
        code: station.Code || '',
        name: station.Name || '',
        region: station.Region || '',
        lat: Number(station.Location.latitude),
        lon: Number(station.Location.longitude),
        point: { x: Number(station.Point.x), y: Number(station.Point.y) },
    }));
}

function normalizeEew(payload) {
    const status = pickString(payload, ['result.status', 'status']) || '';
    const message = pickString(payload, ['result.message', 'message']) || '';
    const regionName = pickString(payload, ['region_name', 'regionName', 'area_name', 'areaName']) || '';
    const originTime = pickString(payload, ['origin_time', 'originTime', 'time']) || '';
    const noDataMessages = ['データがありません', 'No data available', 'no data', 'なし'];
    const isActive = regionName !== '' || originTime !== '' || !noDataMessages.includes(message.trim());

    return {
        status, message,
        requestTime: pickString(payload, ['request_time', 'requestTime']) || '',
        regionName, originTime,
        magnitude: pickString(payload, ['magnitude', 'mag', 'magnitude_value']) || '',
        depth: pickString(payload, ['depth', 'depth_km', 'depthKm']) || '',
        maxIntensity: pickString(payload, ['max_intensity', 'maxIntensity', 'calcintensity', 'intensity']) || '',
        latitude: pickString(payload, ['latitude', 'lat']) || '',
        longitude: pickString(payload, ['longitude', 'lon', 'lng']) || '',
        isFinal: pickBoolean(payload, ['is_final', 'isFinal', 'final']),
        isActive,
    };
}

function buildEewSummary(eew) {
    const titleParts = [];
    if (eew.isFinal !== null) titleParts.push(eew.isFinal ? '最終報' : '速報');
    if (eew.regionName) titleParts.push(eew.regionName);
    
    const summaryParts = [];
    if (eew.maxIntensity) summaryParts.push(`最大震度 ${eew.maxIntensity}`);
    if (eew.magnitude) summaryParts.push(`M${eew.magnitude}`);
    if (eew.depth) summaryParts.push(`深さ ${eew.depth} km`);

    return {
        title: titleParts.join(' - ') || 'EEW発表中',
        summary: summaryParts.join(' / ') || (eew.message || '詳細情報を取得中'),
    };
}

function buildEewDetails(eew) {
    const lines = [];
    if (eew.message) lines.push(`発表内容: ${eew.message}`);
    if (eew.originTime) lines.push(`発生時刻: ${formatTimestamp(eew.originTime)}`);
    if (eew.latitude && eew.longitude) lines.push(`震源: ${eew.latitude}, ${eew.longitude}`);
    return lines.join('\n');
}

function readPixel(context, x, y, width, height) {
    const safeX = Math.max(0, Math.min(width - 1, Math.round(x)));
    const safeY = Math.max(0, Math.min(height - 1, Math.round(y)));
    const [r, g, b, a] = context.getImageData(safeX, safeY, 1, 1).data;
    return { r, g, b, a };
}

function isBackgroundColor(r, g, b) {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max < 18) return true;
    if (max - min < 6 && max < 90) return true;
    return false;
}

function drawStations(stationList) {
    stationLayer.clearLayers();
    stationLayer.addData({
        type: 'FeatureCollection',
        features: stationList.map(station => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
            properties: {
                code: station.code, name: station.name, region: station.region,
                color: station.color, active: station.active, label: station.label || '',
            },
        })),
    });
}

function createStationPoint(feature, latlng) {
    const marker = L.circleMarker(latlng, {
        radius: feature.properties.active ? 4.2 : 2.6,
        fillColor: feature.properties.color,
        color: feature.properties.active ? '#ffffff' : '#1e293b',
        fillOpacity: feature.properties.active ? 0.92 : 0.55,
        opacity: 0.9,
        weight: feature.properties.active ? 0.5 : 0.25,
    });

    const label = feature.properties.label;
    const tooltipText = label
        ? `${escapeHtml(feature.properties.region)} ${escapeHtml(feature.properties.name)}<br><strong>${escapeHtml(label)}</strong>`
        : `${escapeHtml(feature.properties.region)} ${escapeHtml(feature.properties.name)}`;

    marker.bindTooltip(tooltipText, { direction: 'top', opacity: 0.9 });
    return marker;
}

function getValueLabel(r, g, b, imageType) {
    // Canvasから取得したRGB値をもとに、ツールチップに表示する大まかなラベルを返します
    if (imageType === 'jma_s') {
        if (r > 200 && g < 100 && b < 100) return '5+';
        if (r > 180 && g < 80 && b < 80) return '5-';
        if (r > 200 && g > 120 && g < 180 && b < 100) return '4';
        if (r > 150 && g > 150 && b < 100) return '4';
        if (g > 150 && r > 100 && r < 180 && b < 100) return '3';
        if (g > 150 && r < 100 && b < 100) return '3';
        if (b > 150 && g > 100 && r < 150) return '2';
        if (b > 150 && g < 100 && r < 100) return '1';
    }
    return '';
}

function pickString(source, paths) {
    for (const path of paths) {
        const value = readPath(source, path);
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value);
        }
    }
    return '';
}

function pickBoolean(source, paths) {
    for (const path of paths) {
        const value = readPath(source, path);
        if (value === undefined || value === null) continue;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        const text = String(value).toLowerCase();
        if (['true', '1', 'yes', 'final'].includes(text)) return true;
        if (['false', '0', 'no'].includes(text)) return false;
    }
    return null;
}

function readPath(source, path) {
    if (!source || !path) return undefined;
    return String(path).split('.').reduce((value, key) => {
        if (value === undefined || value === null) return undefined;
        return value[key];
    }, source);
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}