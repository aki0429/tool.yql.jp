(() => {
  "use strict";

  const MAX_SELECTED_STATIONS = 10;
  const DEFAULT_POINT = { lat: 35.70999710687594, lng: 139.8108443422566 };
  const API = {
    markers: "proxy.php?mode=markers",
    stationName: "proxy.php?mode=station_name",
    target: "proxy.php?mode=target",
    tvstation: "proxy.php?mode=tvstation"
  };

  const elements = {
    map: document.getElementById("map"),
    resetButton: document.getElementById("reset-button"),
    searchButton: document.getElementById("station-search-button"),
    searchInput: document.getElementById("station-search-input"),
    searchResults: document.getElementById("search-results"),
    selectedCount: document.getElementById("selected-count"),
    selectedList: document.getElementById("selected-list"),
    status: document.getElementById("status")
  };

  const map = L.map(elements.map, {
    doubleClickZoom: false,
    preferCanvas: true
  }).setView([DEFAULT_POINT.lat, DEFAULT_POINT.lng], 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(map);

  const markerLayer = L.layerGroup().addTo(map);
  const selectedMarkerLayer = L.layerGroup().addTo(map);
  const polygonLayer = L.layerGroup().addTo(map);
  const targetLayer = L.layerGroup().addTo(map);

  const state = {
    activePolygons: new Set(),
    polygonCache: new Map(),
    selected: new Map(),
    stations: [],
    stationsById: new Map(),
    targetPoint: null
  };

  function setStatus(message, kind = "") {
    elements.status.textContent = message;
    elements.status.className = kind ? `status ${kind}` : "status";
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  function normalizeStation(raw) {
    return {
      id: Number(raw.id),
      latitude: Number(raw.lat),
      longitude: Number(raw.lng),
      no: String(raw.no || ""),
      openDate: String(raw.openDate || ""),
      powerW: Number(raw.power) || 0,
      prefecture: String(raw.prefecture || ""),
      stationName: String(raw.stationName || `局 ${raw.id}`),
      stationNameKana: String(raw.stationNameKana || ""),
      stationScale: Number(raw.stationScale) || 0
    };
  }

  function station(id) {
    return state.stationsById.get(Number(id)) || null;
  }

  function haversineMeters(a, b) {
    const radius = 6378137;
    const toRad = (value) => value * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(h));
  }

  function formatPower(powerW) {
    if (!Number.isFinite(powerW) || powerW <= 0) {
      return "-";
    }
    return powerW >= 1000 ? `${powerW / 1000} kW` : `${powerW} W`;
  }

  function stationRadius(scale) {
    if (scale <= 1) {
      return 7;
    }
    if (scale === 2) {
      return 5;
    }
    return 4;
  }

  function makeTargetIcon() {
    return L.divIcon({
      className: "",
      html: '<div class="target-icon" style="width:16px;height:16px"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  }

  function setTargetPoint(lat, lng) {
    state.targetPoint = { lat, lng };
    targetLayer.clearLayers();
    L.marker([lat, lng], { icon: makeTargetIcon() })
      .bindPopup(`<strong>目的の地点</strong><p>${lat.toFixed(6)}, ${lng.toFixed(6)}</p>`)
      .addTo(targetLayer);
  }

  async function fetchStationPolygons(stationId) {
    const id = Number(stationId);
    if (state.polygonCache.has(id)) {
      return state.polygonCache.get(id);
    }

    const payload = await fetchJson(`${API.tvstation}&id=${encodeURIComponent(id)}`);
    const polygons = (Array.isArray(payload) ? payload : [])
      .filter((item) => item?.polygon?.type === "Polygon")
      .map((item) => ({
        polygonId: String(item.polygonid || ""),
        relayStation: Number(item.relayStation || id),
        title: String(item.TVstationName || ""),
        polygon: item.polygon
      }));

    state.polygonCache.set(id, polygons);
    return polygons;
  }

  function clearSelection() {
    state.selected.clear();
    state.activePolygons.clear();
    selectedMarkerLayer.clearLayers();
    polygonLayer.clearLayers();
    renderSelectedList();
  }

  function addSelectedMarker(item) {
    L.circleMarker([item.station.latitude, item.station.longitude], {
      radius: stationRadius(item.station.stationScale) + 2,
      color: "#122a88",
      fillColor: "#1c7cd6",
      fillOpacity: 0.95,
      weight: 2
    })
      .bindPopup(`<strong>${item.station.stationName}</strong><p>${formatPower(item.station.powerW)}</p>`)
      .addTo(selectedMarkerLayer);
  }

  async function selectStation(stationId, options = {}) {
    const id = Number(stationId);
    const targetStation = station(id);
    if (!targetStation) {
      return;
    }

    if (state.selected.has(id)) {
      if (options.showPolygonIds) {
        options.showPolygonIds.forEach((polygonId) => state.activePolygons.add(String(polygonId)));
        renderPolygons();
        renderSelectedList();
      }
      return;
    }

    if (state.selected.size >= MAX_SELECTED_STATIONS) {
      alert(`放送局は${MAX_SELECTED_STATIONS}個まで選択可能です。上限を超えています。`);
      return;
    }

    const tvStations = await fetchStationPolygons(id);
    const selectedItem = {
      station: targetStation,
      tvStations
    };
    state.selected.set(id, selectedItem);
    addSelectedMarker(selectedItem);

    if (options.showPolygonIds) {
      options.showPolygonIds.forEach((polygonId) => state.activePolygons.add(String(polygonId)));
    }

    renderPolygons();
    renderSelectedList();
  }

  async function toggleStation(stationId) {
    const id = Number(stationId);
    if (state.selected.has(id)) {
      removeStation(id);
      return;
    }

    await selectStation(id);
  }

  function removeStation(stationId) {
    const id = Number(stationId);
    const item = state.selected.get(id);
    if (!item) {
      return;
    }

    item.tvStations.forEach((tvStation) => state.activePolygons.delete(tvStation.polygonId));
    state.selected.delete(id);
    selectedMarkerLayer.clearLayers();
    state.selected.forEach(addSelectedMarker);
    renderPolygons();
    renderSelectedList();
  }

  function togglePolygon(polygonId) {
    const id = String(polygonId);
    if (state.activePolygons.has(id)) {
      state.activePolygons.delete(id);
    } else {
      state.activePolygons.add(id);
    }
    renderPolygons();
    renderSelectedList();
  }

  function renderPolygons() {
    polygonLayer.clearLayers();

    state.selected.forEach((item) => {
      item.tvStations.forEach((tvStation) => {
        if (!state.activePolygons.has(tvStation.polygonId)) {
          return;
        }

        L.geoJSON(tvStation.polygon, {
          style: {
            color: "#1c7cd6",
            fillColor: "#1c7cd6",
            fillOpacity: 0.18,
            weight: 2
          }
        })
          .bindPopup(`<strong>${item.station.stationName}</strong><p>${tvStation.title}</p>`)
          .addTo(polygonLayer);
      });
    });
  }

  function renderSelectedList() {
    elements.selectedCount.textContent = `${state.selected.size} / ${MAX_SELECTED_STATIONS}`;
    elements.selectedList.replaceChildren();

    if (state.selected.size === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "選択中の中継局はありません。地図をダブルクリックしてください。";
      elements.selectedList.append(empty);
      return;
    }

    state.selected.forEach((item) => {
      const wrapper = document.createElement("div");
      wrapper.className = "station";

      const close = document.createElement("button");
      close.className = "station-close";
      close.type = "button";
      close.textContent = "×";
      close.addEventListener("click", () => removeStation(item.station.id));

      const name = document.createElement("div");
      name.className = "station-name";
      name.textContent = item.station.stationName;
      name.addEventListener("click", () => map.setView([item.station.latitude, item.station.longitude], 12));

      const meta = document.createElement("p");
      meta.className = "station-meta";
      meta.textContent = `出力 ${formatPower(item.station.powerW)} / 開局 ${item.station.openDate || "-"}`;

      wrapper.append(close, name, meta);

      item.tvStations.forEach((tvStation) => {
        const row = document.createElement("div");
        row.className = "station-tv";

        const button = document.createElement("button");
        button.className = `toggle-polygon ${state.activePolygons.has(tvStation.polygonId) ? "active" : ""}`;
        button.type = "button";
        button.textContent = state.activePolygons.has(tvStation.polygonId) ? "ON" : "OFF";
        button.addEventListener("click", () => togglePolygon(tvStation.polygonId));

        const label = document.createElement("span");
        label.textContent = tvStation.title || tvStation.polygonId;

        row.append(button, label);
        wrapper.append(row);
      });

      elements.selectedList.append(wrapper);
    });
  }

  function renderStationMarkers() {
    markerLayer.clearLayers();

    state.stations.forEach((item) => {
      L.circleMarker([item.latitude, item.longitude], {
        radius: stationRadius(item.stationScale),
        color: "#fff",
        fillColor: "#1c7cd6",
        fillOpacity: 0.72,
        weight: 1
      })
        .bindPopup(`<strong>${item.stationName}</strong><p>${formatPower(item.powerW)}</p>`)
        .on("click", () => toggleStation(item.id))
        .addTo(markerLayer);
    });
  }

  function groupTargetStations(targetStations) {
    const grouped = new Map();

    (Array.isArray(targetStations) ? targetStations : []).forEach((item) => {
      const id = Number(item.relayStation);
      if (!Number.isFinite(id) || !station(id)) {
        return;
      }
      if (!grouped.has(id)) {
        grouped.set(id, {
          relayStation: id,
          polygonIds: []
        });
      }
      if (item.polygonid) {
        grouped.get(id).polygonIds.push(String(item.polygonid));
      }
    });

    return [...grouped.values()];
  }

  async function selectTargetStations(lat, lng) {
    setTargetPoint(lat, lng);
    map.setView([lat, lng], Math.max(map.getZoom(), 11));
    setStatus("対象局を検索しています...");

    const targetStations = await fetchJson(`${API.target}&lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
    const point = { lat, lng };
    const groupedTargets = groupTargetStations(targetStations)
      .map((item) => {
        const targetStation = station(item.relayStation);
        return {
          ...item,
          distanceMeters: haversineMeters(point, {
            lat: targetStation.latitude,
            lng: targetStation.longitude
          })
        };
      })
      .sort((left, right) => left.distanceMeters - right.distanceMeters)
      .slice(0, MAX_SELECTED_STATIONS);

    clearSelection();

    for (const item of groupedTargets) {
      await selectStation(item.relayStation, { showPolygonIds: item.polygonIds });
    }

    if (groupedTargets.length === 0) {
      setStatus("この地点の対象局は見つかりませんでした。", "error");
    } else {
      setStatus(`${groupedTargets.length}件の対象局を選択しました。`, "success");
    }
  }

  function parsePagePoint() {
    const search = new URLSearchParams(window.location.search);
    const hashQuery = window.location.hash.includes("?") ? window.location.hash.split("?")[1] : "";
    const hashSearch = new URLSearchParams(hashQuery);
    const lat = Number.parseFloat(search.get("lat") || hashSearch.get("lat"));
    const lng = Number.parseFloat(search.get("lng") || hashSearch.get("lng"));

    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  function renderSearchResults(results) {
    elements.searchResults.replaceChildren();

    if (!results.length) {
      elements.searchResults.hidden = true;
      return;
    }

    results.slice(0, MAX_SELECTED_STATIONS).forEach((raw) => {
      const item = normalizeStation(raw);
      const result = document.createElement("div");
      result.className = "search-result";

      const name = document.createElement("strong");
      name.textContent = item.stationName;

      const meta = document.createElement("p");
      meta.textContent = `${item.prefecture || "-"} / ${item.stationNameKana || ""}`;

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "この局を選択";
      button.addEventListener("click", async () => {
        if (!state.stationsById.has(item.id)) {
          state.stationsById.set(item.id, item);
        }
        map.setView([item.latitude, item.longitude], 12);
        await selectStation(item.id);
        elements.searchResults.hidden = true;
      });

      result.append(name, meta, button);
      elements.searchResults.append(result);
    });

    elements.searchResults.hidden = false;
  }

  async function searchStation() {
    const keyword = elements.searchInput.value.trim();
    if (!keyword) {
      elements.searchResults.hidden = true;
      return;
    }

    setStatus("局名を検索しています...");
    try {
      const results = await fetchJson(`${API.stationName}&name=${encodeURIComponent(keyword)}`);
      renderSearchResults(Array.isArray(results) ? results : []);
      setStatus(`${Array.isArray(results) ? Math.min(results.length, MAX_SELECTED_STATIONS) : 0}件を表示しました。`, "success");
    } catch (error) {
      setStatus(`検索に失敗しました: ${error.message}`, "error");
    }
  }

  function resetMap() {
    clearSelection();
    targetLayer.clearLayers();
    elements.searchResults.hidden = true;
    state.targetPoint = null;
    map.setView([DEFAULT_POINT.lat, DEFAULT_POINT.lng], 11);
    setStatus("地図をダブルクリックすると、その地点の対象局を最大10件選択します。");
  }

  async function loadStations() {
    setStatus("局一覧を読み込んでいます...");
    const markerData = await fetchJson(API.markers);
    state.stations = (Array.isArray(markerData) ? markerData : [])
      .map(normalizeStation)
      .filter((item) => Number.isFinite(item.id) && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
    state.stationsById = new Map(state.stations.map((item) => [item.id, item]));
    renderStationMarkers();
    renderSelectedList();
    setStatus(`局一覧 ${state.stations.length.toLocaleString("ja-JP")}件を読み込みました。`, "success");

    const pagePoint = parsePagePoint();
    if (pagePoint) {
      await selectTargetStations(pagePoint.lat, pagePoint.lng);
    }
  }

  map.on("dblclick", (event) => {
    selectTargetStations(event.latlng.lat, event.latlng.lng).catch((error) => {
      setStatus(`対象局の検索に失敗しました: ${error.message}`, "error");
    });
  });

  elements.searchButton.addEventListener("click", () => {
    searchStation();
  });

  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      searchStation();
    }
  });

  elements.resetButton.addEventListener("click", resetMap);

  loadStations().catch((error) => {
    setStatus(`初期化に失敗しました: ${error.message}`, "error");
  });
})();
