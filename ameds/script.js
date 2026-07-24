const METRICS = {
    temp: { label: "気温", unit: "℃", palette: "temperature" },
    precipitation10m: { label: "降水量 10分", unit: "mm", palette: "precipitation" },
    precipitation1h: { label: "降水量 1時間", unit: "mm", palette: "precipitation" },
    precipitation3h: { label: "降水量 3時間", unit: "mm", palette: "precipitation" },
    precipitation24h: { label: "降水量 24時間", unit: "mm", palette: "precipitation" },
    humidity: { label: "湿度", unit: "%", palette: "generic" },
    wind: { label: "風速", unit: "m/s", palette: "generic" },
    sun10m: { label: "日照時間 10分", unit: "分", palette: "generic" },
    sun1h: { label: "日照時間 1時間", unit: "分", palette: "generic" },
    snow1h: { label: "積雪量 1時間", unit: "cm", palette: "generic" },
    snow: { label: "積雪深", unit: "cm", palette: "generic" },
    pressure: { label: "気圧 現地", unit: "hPa", palette: "generic" },
    normalPressure: { label: "気圧 海面", unit: "hPa", palette: "generic" }
};

const TEMPERATURE_SCALE = [
    { min: 40, label: "40℃以上", color: "#8b00ff" },
    { min: 35, label: "35 - 40℃", color: "#e60033" },
    { min: 30, label: "30 - 35℃", color: "#ff7a00" },
    { min: 25, label: "25 - 30℃", color: "#ffd400" },
    { min: 20, label: "20 - 25℃", color: "#a7d900" },
    { min: 15, label: "15 - 20℃", color: "#20a464" },
    { min: 10, label: "10 - 15℃", color: "#b8f3ff" },
    { min: 5, label: "5 - 10℃", color: "#35c8ff" },
    { min: 0, label: "0 - 5℃", color: "#006dff" },
    { min: -5, label: "-5 - 0℃", color: "#9ca3af" },
    { min: -10, label: "-10 - -5℃", color: "#ffffff" },
    { min: -15, label: "-15 - -10℃", color: "#555555" },
    { min: -Infinity, label: "-15℃未満", color: "#000000" }
];

const PRECIPITATION_SCALE = [
    { min: 80, label: "80mm以上", color: "#000000" },
    { min: 50, label: "50 - 80mm", color: "#8b00ff" },
    { min: 30, label: "30 - 50mm", color: "#e60033" },
    { min: 20, label: "20 - 30mm", color: "#ff7a00" },
    { min: 10, label: "10 - 20mm", color: "#ffd400" },
    { min: 7, label: "7 - 10mm", color: "#20a464" },
    { min: 5, label: "5 - 7mm", color: "#a7d900" },
    { min: 3, label: "3 - 5mm", color: "#006dff" },
    { min: 2, label: "2 - 3mm", color: "#35c8ff" },
    { min: 1, label: "1 - 2mm", color: "#b8f3ff" },
    { min: 0.5, label: "0.5 - 1mm", color: "#ffffff" },
    { min: 0.1, label: "0.1 - 0.5mm", color: "#f3f8fb" },
    { min: -Infinity, label: "0mm", color: "#d9e1e8" }
];

const GENERIC_SCALE = [
    { min: 80, label: "80以上", color: "#8b00ff" },
    { min: 50, label: "50 - 80", color: "#e60033" },
    { min: 30, label: "30 - 50", color: "#ff7a00" },
    { min: 20, label: "20 - 30", color: "#ffd400" },
    { min: 10, label: "10 - 20", color: "#20a464" },
    { min: 5, label: "5 - 10", color: "#35c8ff" },
    { min: 0.1, label: "0.1 - 5", color: "#b8f3ff" },
    { min: -Infinity, label: "0または未満", color: "#d9e1e8" }
];

const STATION_MARKER_RADIUS = 6;

const REGIONS = {
    "0": { name: "全体", bounds: [[20.0, 122.0], [46.5, 154.5]] },
    "1": { name: "北海道", bounds: [[41.1, 139.0], [45.8, 146.5]] },
    "2": { name: "東北", bounds: [[36.7, 139.0], [41.7, 142.3]] },
    "3": { name: "関東", bounds: [[34.6, 138.0], [37.2, 141.2]] },
    "4": { name: "東海北陸", bounds: [[34.1, 135.4], [38.0, 139.6]] },
    "5": { name: "関西", bounds: [[33.4, 134.2], [36.1, 137.0]] },
    "6": { name: "中国", bounds: [[33.4, 130.7], [35.8, 134.9]] },
    "7": { name: "四国", bounds: [[32.6, 132.0], [34.8, 134.9]] },
    "8": { name: "九州", bounds: [[30.7, 128.7], [34.2, 132.4]] },
    "9": { name: "沖縄", bounds: [[23.5, 122.8], [27.2, 131.4]] }
};

const state = {
    map: null,
    stationLayer: null,
    boundaryLayer: null,
    outsideMaskLayer: null,
    landBoundary: null,
    landIndex: [],
    sourcesConfig: null,
    observations: [],
    selectedSourceIds: new Set(["jma-amedas"]),
    selectedMetric: "temp"
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
    initMap();
    bindControls();
    bindHotkeys();
    await Promise.all([loadSourceConfig(), loadLandBoundary()]);
    await refresh();
}

function initMap() {
    state.map = L.map("map", {
        center: [37.8, 137.8],
        zoom: 5,
        minZoom: 4,
        zoomSnap: 0.25,
        dragging: false
    });
    state.map.dragging.disable();

    state.stationLayer = L.layerGroup().addTo(state.map);
}

function bindControls() {
    document.getElementById("metricSelect").addEventListener("change", (event) => {
        state.selectedMetric = event.target.value;
        renderStations();
    });
}

function bindHotkeys() {
    window.addEventListener("keydown", (event) => {
        if (event.key === "Control") {
            setCtrlPanEnabled(true);
            return;
        }

        if (/^[0-9]$/.test(event.key)) {
            event.preventDefault();
            flyToRegion(event.key);
            return;
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            panNorth();
        }
    });

    window.addEventListener("keyup", (event) => {
        if (event.key === "Control") setCtrlPanEnabled(false);
    });
    window.addEventListener("blur", () => setCtrlPanEnabled(false));
}

function setCtrlPanEnabled(enabled) {
    if (!state.map) return;
    if (enabled) {
        state.map.dragging.enable();
        state.map.getContainer().classList.add("is-ctrl-pan");
    } else {
        state.map.dragging.disable();
        state.map.getContainer().classList.remove("is-ctrl-pan");
    }
}

function flyToRegion(regionId) {
    const region = REGIONS[regionId];
    if (!region || !state.map) return;
    const regionSelect = document.getElementById("regionSelect");
    if (regionSelect) regionSelect.value = regionId;
    state.map.fitBounds(region.bounds, { padding: [28, 28], animate: true });
    state.map._hasFitInitialAmedasBounds = true;
}

function panNorth() {
    if (!state.map) return;
    const size = state.map.getSize();
    state.map.panBy([0, -Math.max(160, size.y * 0.38)], { animate: true });
}

async function loadLandBoundary() {
    setStatus("GeoJSON境界を読み込み中...");
    const response = await fetch("map.geojson");
    if (!response.ok) throw new Error(`map.geojson HTTP ${response.status}`);
    state.landBoundary = await response.json();
    state.landIndex = buildLandIndex(state.landBoundary);

    new ClippedAerialLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", {
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html">地理院タイル</a>',
        landIndex: state.landIndex,
        opacity: 0.82,
        zIndex: 100,
        maxZoom: 18
    }).addTo(state.map);

    state.outsideMaskLayer = new OutsideJapanMaskLayer({
        landIndex: state.landIndex,
        zIndex: 190,
        maxZoom: 18
    }).addTo(state.map);

    state.boundaryLayer = new BoundaryCanvasLayer({
        landIndex: state.landIndex,
        zIndex: 210,
        maxZoom: 18
    }).addTo(state.map);
}

class ClippedAerialLayer extends L.GridLayer {
    constructor(urlTemplate, options) {
        super(options);
        this.urlTemplate = urlTemplate;
        this.landIndex = options.landIndex || [];
    }

    createTile(coords, done) {
        const tile = document.createElement("canvas");
        const size = this.getTileSize();
        tile.width = size.x;
        tile.height = size.y;
        const ctx = tile.getContext("2d");
        const image = new Image();
        image.crossOrigin = "anonymous";

        image.onload = () => {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, size.x, size.y);
            ctx.save();
            this.traceLandPath(ctx, coords, size);
            ctx.clip("evenodd");
            ctx.drawImage(image, 0, 0, size.x, size.y);
            ctx.restore();
            done(null, tile);
        };
        image.onerror = () => {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, size.x, size.y);
            done(null, tile);
        };
        image.src = L.Util.template(this.urlTemplate, coords);
        return tile;
    }

    traceLandPath(ctx, coords, size) {
        const z = coords.z;
        const origin = L.point(coords.x * size.x, coords.y * size.y);
        const tileBounds = tileLatLngBounds(coords.x, coords.y, z);

        ctx.beginPath();
        for (const item of this.landIndex) {
            if (!bboxIntersectsLatLng(item.bbox, tileBounds)) continue;
            for (const polygon of item.polygons) {
                for (const ring of polygon) {
                    if (ring.length < 3) continue;
                    ring.forEach(([lng, lat], index) => {
                        const point = this._map.project([lat, lng], z).subtract(origin);
                        if (index === 0) {
                            ctx.moveTo(point.x, point.y);
                        } else {
                            ctx.lineTo(point.x, point.y);
                        }
                    });
                    ctx.closePath();
                }
            }
        }
    }
}

class OutsideJapanMaskLayer extends L.GridLayer {
    constructor(options) {
        super(options);
        this.landIndex = options.landIndex || [];
    }

    createTile(coords, done) {
        const tile = document.createElement("canvas");
        const size = this.getTileSize();
        tile.width = size.x;
        tile.height = size.y;
        const ctx = tile.getContext("2d");
        const origin = L.point(coords.x * size.x, coords.y * size.y);
        const tileBounds = tileLatLngBounds(coords.x, coords.y, coords.z);

        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.rect(0, 0, size.x, size.y);

        for (const item of this.landIndex) {
            if (!bboxIntersectsLatLng(item.bbox, tileBounds)) continue;
            for (const polygon of item.polygons) {
                for (const ring of polygon) {
                    if (ring.length < 3) continue;
                    ring.forEach(([lng, lat], index) => {
                        const point = this._map.project([lat, lng], coords.z).subtract(origin);
                        if (index === 0) {
                            ctx.moveTo(point.x, point.y);
                        } else {
                            ctx.lineTo(point.x, point.y);
                        }
                    });
                    ctx.closePath();
                }
            }
        }

        ctx.fill("evenodd");
        done(null, tile);
        return tile;
    }
}

class BoundaryCanvasLayer extends L.GridLayer {
    constructor(options) {
        super(options);
        this.landIndex = options.landIndex || [];
    }

    createTile(coords, done) {
        const tile = document.createElement("canvas");
        const size = this.getTileSize();
        tile.width = size.x;
        tile.height = size.y;
        const ctx = tile.getContext("2d");
        const origin = L.point(coords.x * size.x, coords.y * size.y);
        const tileBounds = tileLatLngBounds(coords.x, coords.y, coords.z);

        ctx.strokeStyle = "rgba(78, 89, 100, 0.86)";
        ctx.lineWidth = Math.max(0.55, coords.z / 12);
        ctx.lineJoin = "round";
        ctx.lineCap = "round";

        for (const item of this.landIndex) {
            if (!bboxIntersectsLatLng(item.bbox, tileBounds)) continue;
            ctx.beginPath();
            for (const polygon of item.polygons) {
                for (const ring of polygon) {
                    if (ring.length < 3) continue;
                    ring.forEach(([lng, lat], index) => {
                        const point = this._map.project([lat, lng], coords.z).subtract(origin);
                        if (index === 0) {
                            ctx.moveTo(point.x, point.y);
                        } else {
                            ctx.lineTo(point.x, point.y);
                        }
                    });
                    ctx.closePath();
                }
            }
            ctx.stroke();
        }

        done(null, tile);
        return tile;
    }
}

function buildLandIndex(geojson) {
    return (geojson.features || [])
        .filter((feature) => feature.geometry)
        .map((feature) => {
            const polygons = geometryToPolygons(feature.geometry);
            return { polygons, bbox: polygonBbox(polygons) };
        })
        .filter((item) => item.polygons.length > 0 && item.bbox);
}

function geometryToPolygons(geometry) {
    if (geometry.type === "Polygon") return [geometry.coordinates];
    if (geometry.type === "MultiPolygon") return geometry.coordinates;
    return [];
}

function polygonBbox(polygons) {
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const polygon of polygons) {
        for (const ring of polygon) {
            for (const [lng, lat] of ring) {
                minLng = Math.min(minLng, lng);
                minLat = Math.min(minLat, lat);
                maxLng = Math.max(maxLng, lng);
                maxLat = Math.max(maxLat, lat);
            }
        }
    }
    return Number.isFinite(minLng) ? { minLng, minLat, maxLng, maxLat } : null;
}

function tileLatLngBounds(x, y, z) {
    const nw = tilePointToLatLng(x, y, z);
    const se = tilePointToLatLng(x + 1, y + 1, z);
    return {
        minLng: nw.lng,
        maxLng: se.lng,
        minLat: se.lat,
        maxLat: nw.lat
    };
}

function tilePointToLatLng(x, y, z) {
    const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
    return {
        lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
        lng: (x / Math.pow(2, z)) * 360 - 180
    };
}

function bboxIntersectsLatLng(a, b) {
    return a.minLng <= b.maxLng && a.maxLng >= b.minLng && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

function isInsideJapanArea(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    for (const item of state.landIndex) {
        if (lng < item.bbox.minLng || lng > item.bbox.maxLng || lat < item.bbox.minLat || lat > item.bbox.maxLat) continue;
        for (const polygon of item.polygons) {
            if (pointInPolygonWithHoles(lat, lng, polygon)) return true;
        }
    }
    return false;
}

function isInJapanViewBounds(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) && lat >= 20 && lat <= 46.8 && lng >= 122 && lng <= 154.8;
}

function shouldRenderObservation(observation) {
    if (isInsideJapanArea(observation.latitude, observation.longitude)) return true;
    return observation.sourceId !== "jma-amedas" && isInJapanViewBounds(observation.latitude, observation.longitude);
}

function pointInPolygonWithHoles(lat, lng, polygon) {
    if (!polygon.length || !pointInRing(lat, lng, polygon[0])) return false;
    for (let index = 1; index < polygon.length; index += 1) {
        if (pointInRing(lat, lng, polygon[index])) return false;
    }
    return true;
}

function pointInRing(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];
        const intersects = ((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi || Number.EPSILON) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

async function loadSourceConfig() {
    const response = await fetch("data_sources.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`data_sources.json HTTP ${response.status}`);
    state.sourcesConfig = await response.json();
    state.selectedSourceIds = new Set(state.sourcesConfig.defaultSourceIds || ["jma-amedas"]);
    renderSourceControls();
}

function renderSourceControls() {
    const root = document.getElementById("sourceControls");
    root.innerHTML = "";
    const labels = {
        "jma-amedas": "気象庁",
        "mlit-rain": "国土交通省",
        "prefecture-rain": "都道府県"
    };

    for (const source of state.sourcesConfig.sources) {
        const item = document.createElement("label");
        item.className = `source-item${source.status === "endpoint-required" ? " is-unavailable" : ""}`;
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = state.selectedSourceIds.has(source.id);
        checkbox.addEventListener("change", async () => {
            if (checkbox.checked) {
                state.selectedSourceIds.add(source.id);
            } else {
                state.selectedSourceIds.delete(source.id);
            }
            await refresh();
        });
        item.append(checkbox, document.createTextNode(labels[source.id] || source.name));
        root.appendChild(item);
    }
}

async function refresh() {
    if (!state.sourcesConfig) return;
    setStatus("観測データを取得中...");
    const selectedSources = state.sourcesConfig.sources.filter((source) => state.selectedSourceIds.has(source.id));
    const results = await Promise.allSettled(selectedSources.map(loadSource));
    const observations = [];
    const messages = [];

    results.forEach((result, index) => {
        const source = selectedSources[index];
        if (result.status === "fulfilled") {
            observations.push(...result.value.observations);
            messages.push(`${escapeHtml(source.name)}: ${result.value.observations.length}地点`);
        } else {
            messages.push(`${escapeHtml(source.name)}: ${escapeHtml(result.reason.message)}`);
        }
    });

    state.observations = observations;
    renderStations();
    setStatus(messages.join("<br>") || "取得先が選択されていません");
}

async function loadSource(source) {
    if (source.type === "jma-amedas") return loadJmaAmedas(source);
    if (source.type === "mlit-kawabou") return loadMlitKawabou(source);
    if (source.type === "geojson-rain") return loadGeoJsonRain(source);
    if (source.type === "prefecture-index") return loadPrefectureRain(source);
    throw new Error(`未対応の形式: ${source.type}`);
}

async function loadJmaAmedas(source) {
    const latestResponse = await fetch(source.endpoints.latestTime, { cache: "no-store" });
    if (!latestResponse.ok) throw new Error(`latest_time HTTP ${latestResponse.status}`);
    const latestTimeText = (await latestResponse.text()).trim();
    const timestamp = formatJmaTimestamp(latestTimeText);
    const observationsUrl = source.endpoints.observationsTemplate.replace("{yyyymmddHHMMss}", timestamp);

    const [stationsResponse, observationsResponse] = await Promise.all([
        fetch(source.endpoints.stations, { cache: "force-cache" }),
        fetch(observationsUrl, { cache: "no-store" })
    ]);
    if (!stationsResponse.ok) throw new Error(`amedastable HTTP ${stationsResponse.status}`);
    if (!observationsResponse.ok) throw new Error(`observations HTTP ${observationsResponse.status}`);

    const stations = await stationsResponse.json();
    const observationMap = await observationsResponse.json();
    const observations = Object.entries(stations).map(([id, station]) => {
        const raw = observationMap[id] || {};
        return {
            id: `${source.id}-${id}`,
            stationId: id,
            sourceId: source.id,
            sourceName: source.name,
            provider: source.provider,
            name: station.kjName || station.enName || id,
            prefecture: station.prefecture || "",
            latitude: toDecimalDegree(station.lat),
            longitude: toDecimalDegree(station.lon),
            observedAt: latestTimeText,
            values: {
                temp: readJmaValue(raw.temp),
                precipitation10m: readJmaValue(raw.precipitation10m),
                precipitation1h: readJmaValue(raw.precipitation1h),
                precipitation3h: readJmaValue(raw.precipitation3h),
                precipitation24h: readJmaValue(raw.precipitation24h),
                humidity: readJmaValue(raw.humidity),
                wind: readJmaValue(raw.wind),
                windDirection: readJmaValue(raw.windDirection),
                sun10m: readJmaValue(raw.sun10m),
                sun1h: readJmaValue(raw.sun1h),
                snow1h: readJmaValue(raw.snow1h),
                snow: readJmaValue(raw.snow),
                pressure: readJmaValue(raw.pressure),
                normalPressure: readJmaValue(raw.normalPressure)
            }
        };
    }).filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude));

    return { observations };
}

async function loadGeoJsonRain(source) {
    const url = source.endpoints?.observations;
    if (!url) throw new Error("取得先URL未設定");
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.text();
    if (body.trim().startsWith("<?php")) {
        throw new Error("PHPが実行されず静的配信されています");
    }
    const geojson = JSON.parse(body);
    const features = Array.isArray(geojson.features) ? geojson.features : [];

    return {
        observations: features.map((feature, index) => {
            const lon = getPath(feature, source.mapping.longitude);
            const lat = getPath(feature, source.mapping.latitude);
            return {
                id: `${source.id}-${getPath(feature, source.mapping.id) || index}`,
                sourceId: source.id,
                sourceName: source.name,
                provider: source.provider,
                name: getPath(feature, source.mapping.name) || "雨量観測点",
                latitude: Number(lat),
                longitude: Number(lon),
                values: {
                    precipitation10m: toNumberOrNull(getPath(feature, source.mapping.precipitation10m)),
                    precipitation1h: toNumberOrNull(getPath(feature, source.mapping.precipitation1h)),
                    precipitation3h: toNumberOrNull(getPath(feature, source.mapping.precipitation3h)),
                    precipitation24h: toNumberOrNull(getPath(feature, source.mapping.precipitation24h)),
                    sun10m: toNumberOrNull(getPath(feature, source.mapping.sun10m)),
                    sun1h: toNumberOrNull(getPath(feature, source.mapping.sun1h))
                }
            };
        }).filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude))
    };
}

async function loadMlitKawabou(source) {
    try {
        return await loadGeoJsonRain(source);
    } catch (error) {
        console.warn("MLIT loader fallback:", error);
        const seed = parseMlitSeedUrl(source.seedUrl || "");
        if (!seed) throw error;
        return {
            observations: [{
                id: `${source.id}-${seed.ofcCd}-${seed.itmkndCd}-${seed.obsCd}`,
                sourceId: source.id,
                sourceName: source.name,
                provider: source.provider,
                name: `国交省 雨量 ${seed.obsCd}`,
                latitude: seed.lat,
                longitude: seed.lon,
                values: {
                    precipitation10m: null,
                    precipitation1h: null,
                    precipitation3h: null,
                    precipitation24h: null
                }
            }]
        };
    }
}

function parseMlitSeedUrl(seedUrl) {
    try {
        const url = new URL(seedUrl);
        const lat = Number(url.searchParams.get("clat"));
        const lon = Number(url.searchParams.get("clon"));
        const ofcCd = url.searchParams.get("ofcCd") || "";
        const itmkndCd = url.searchParams.get("itmkndCd") || "";
        const obsCd = url.searchParams.get("obsCd") || "";
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !ofcCd || !itmkndCd || !obsCd) return null;
        return { lat, lon, ofcCd, itmkndCd, obsCd };
    } catch (error) {
        return null;
    }
}

async function loadPrefectureRain(source) {
    const enabledSources = Array.isArray(source.sources) ? source.sources.filter((item) => item.enabled) : [];
    if (enabledSources.length === 0) throw new Error("都道府県別の取得先URL未設定");
    const results = await Promise.allSettled(enabledSources.map((item) => loadGeoJsonRain({
        ...item,
        id: `${source.id}-${item.id}`,
        provider: item.prefecture || source.provider,
        type: "geojson-rain"
    })));
    return {
        observations: results.flatMap((result) => result.status === "fulfilled" ? result.value.observations : [])
    };
}

function renderStations() {
    state.stationLayer.clearLayers();
    renderLegend();
    const metric = METRICS[state.selectedMetric];
    const bounds = [];

    for (const observation of state.observations) {
        if (!shouldRenderObservation(observation)) continue;
        const value = observation.values?.[state.selectedMetric];
        const color = getMetricColor(state.selectedMetric, value);
        const marker = L.circleMarker([observation.latitude, observation.longitude], {
            radius: STATION_MARKER_RADIUS,
            color,
            weight: 3,
            fillColor: color,
            fillOpacity: 0.16,
            opacity: 1,
            className: "amedas-ring"
        });
        marker.bindTooltip(`${observation.name} ${formatValue(value, metric.unit)}`);
        marker.bindPopup(renderPopup(observation));
        marker.addTo(state.stationLayer);
        bounds.push([observation.latitude, observation.longitude]);
    }

    if (bounds.length > 0 && !state.map._hasFitInitialAmedasBounds) {
        state.map.fitBounds(bounds, { padding: [18, 18] });
        state.map._hasFitInitialAmedasBounds = true;
    }
}

function renderPopup(observation) {
    const values = observation.values || {};
    const rows = [
        ["気温", values.temp, "℃"],
        ["降水量 10分", values.precipitation10m, "mm"],
        ["降水量 1時間", values.precipitation1h, "mm"],
        ["降水量 3時間", values.precipitation3h, "mm"],
        ["降水量 24時間", values.precipitation24h, "mm"],
        ["湿度", values.humidity, "%"],
        ["風速", values.wind, "m/s"],
        ["風向", formatWindDirection(values.windDirection), ""],
        ["日照時間 10分", values.sun10m, "分"],
        ["日照時間 1時間", values.sun1h, "分"],
        ["積雪量 1時間", values.snow1h, "cm"],
        ["積雪深", values.snow, "cm"],
        ["気圧 現地", values.pressure, "hPa"],
        ["気圧 海面", values.normalPressure, "hPa"]
    ];
    const prefecture = observation.prefecture ? `${escapeHtml(observation.prefecture)} / ` : "";
    return `
        <div class="station-popup">
            <h2>${escapeHtml(observation.name)}</h2>
            <div class="station-popup__meta">${prefecture}${escapeHtml(observation.sourceName)}<br>${escapeHtml(observation.observedAt || "")}</div>
            <table><tbody>
                ${rows.map(([label, value, unit]) => `
                    <tr><th>${escapeHtml(label)}</th><td>${typeof value === "string" ? escapeHtml(value) : formatValue(value, unit)}</td></tr>
                `).join("")}
            </tbody></table>
        </div>
    `;
}

function renderLegend() {
    const metric = METRICS[state.selectedMetric];
    const scale = getScale(metric.palette);
    document.getElementById("legendTitle").textContent = `${metric.label} ${metric.unit ? `(${metric.unit})` : ""}`;
    document.getElementById("legendItems").innerHTML = scale.map((item) => `
        <div class="legend__item">
            <span class="legend__swatch" style="background:${item.color}"></span>
            <span>${item.label}</span>
        </div>
    `).join("");
}

function getMetricColor(metricId, value) {
    const metric = METRICS[metricId];
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return "#aeb8c2";
    return getScale(metric.palette).find((item) => numericValue >= item.min)?.color || "#aeb8c2";
}

function getScale(palette) {
    if (palette === "temperature") return TEMPERATURE_SCALE;
    if (palette === "precipitation") return PRECIPITATION_SCALE;
    return GENERIC_SCALE;
}

function formatJmaTimestamp(isoText) {
    const match = isoText.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (!match) throw new Error(`時刻形式が不正です: ${isoText}`);
    return match.slice(1).join("");
}

function readJmaValue(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    return toNumberOrNull(raw);
}

function toDecimalDegree(value) {
    if (!Array.isArray(value) || value.length < 2) return null;
    return Number(value[0]) + Number(value[1]) / 60;
}

function toNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function getPath(object, path) {
    if (!path) return undefined;
    return path.split(".").reduce((current, key) => {
        if (current === null || current === undefined) return undefined;
        if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
        return current[key];
    }, object);
}

function formatValue(value, unit) {
    if (value === null || value === undefined || value === "" || Number.isNaN(value)) return "-";
    if (typeof value === "string") return value;
    return `${Number(value).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}${unit}`;
}

function formatWindDirection(value) {
    if (value === null || value === undefined) return "-";
    const directions = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
    const index = Number(value);
    return Number.isFinite(index) ? (directions[index % 16] || `${index}`) : "-";
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[char]));
}

function setStatus(message) {
    document.getElementById("status").innerHTML = message;
}
