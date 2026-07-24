(() => {
  "use strict";

  const LIVE_DATA_URL = "proxy.php";
  const LOCAL_DATA_URL = "data/sites.geojson";
  const DEMO_DATA_URL = "data/sample-sites.geojson";
  const COVERAGE_TILE_URL = "https://www.flightaware.com/coverage_map/img_{source}_latest/{altitude}/{z}/{x}_{y}.png";
  const COVERAGE_SOURCE_ORDER = ["oceanic", "spb", "radar", "adsb_1090", "adsb_978", "mlat"];
  const JAPAN_VIEW = { center: [36.2, 138.2], zoom: 5 };

  const elements = {
    clearFilterButton: document.getElementById("clear-filter-button"),
    coverageAltitude: document.getElementById("coverage-altitude"),
    coverageEnabled: document.getElementById("coverage-enabled"),
    coverageLayerInputs: [...document.querySelectorAll(".coverage-layer-input")],
    coverageLayers: document.querySelector(".coverage-layers"),
    demoButton: document.getElementById("demo-button"),
    dropZone: document.getElementById("drop-zone"),
    fileInput: document.getElementById("file-input"),
    localButton: document.getElementById("local-button"),
    refreshButton: document.getElementById("refresh-button"),
    searchInput: document.getElementById("search-input"),
    sourceUpdated: document.getElementById("source-updated"),
    status: document.getElementById("status"),
    totalCount: document.getElementById("total-count"),
    typeSelect: document.getElementById("type-select"),
    visibleCount: document.getElementById("visible-count")
  };

  const map = L.map("map", { preferCanvas: true }).setView(JAPAN_VIEW.center, JAPAN_VIEW.zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
    maxZoom: 19
  }).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  const coverageGroup = L.layerGroup().addTo(map);
  const markerGroup = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 48,
    showCoverageOnHover: false
  }).addTo(map);

  const state = {
    sites: [],
    source: "",
    sourceUpdatedAt: ""
  };

  function setStatus(message, kind = "") {
    elements.status.textContent = message;
    elements.status.className = `status ${kind}`.trim();
  }

  function drawCoverage() {
    const enabled = elements.coverageEnabled.checked;
    elements.coverageAltitude.disabled = !enabled;
    elements.coverageLayerInputs.forEach((input) => {
      input.disabled = !enabled;
    });
    elements.coverageLayers.classList.toggle("is-disabled", !enabled);
    coverageGroup.clearLayers();

    if (!enabled) {
      return;
    }

    const selectedSources = new Set(
      elements.coverageLayerInputs.filter((input) => input.checked).map((input) => input.value)
    );
    const altitude = elements.coverageAltitude.value;

    COVERAGE_SOURCE_ORDER.filter((source) => selectedSources.has(source)).forEach((source) => {
      const url = COVERAGE_TILE_URL.replace("{source}", source).replace("{altitude}", altitude);
      L.tileLayer(url, {
        attribution: 'Data Coverage: &copy; <a href="https://ja.flightaware.com/adsb/coverage/#data-coverage" target="_blank" rel="noopener noreferrer">FlightAware</a>',
        maxNativeZoom: 6,
        maxZoom: 19,
        opacity: 0.74
      }).addTo(coverageGroup);
    });
  }

  function readFirst(object, keys) {
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null && object[key] !== "") {
        return object[key];
      }
    }
    return "";
  }

  function finiteCoordinate(value) {
    const number = typeof value === "string" ? Number.parseFloat(value.trim()) : Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function methodLabel(method) {
    switch (method.toLowerCase()) {
      case "flightfeeder":
        return "FlightFeeder";
      case "adept":
        return "PiAware";
      case "radarcape":
        return "Radarcape";
      default:
        return method || "未分類";
    }
  }

  function normalizeRecord(record, index) {
    const isFeature = record && record.type === "Feature";
    const properties = isFeature ? (record.properties || {}) : (record || {});
    const coordinates = isFeature && record.geometry && record.geometry.type === "Point"
      ? record.geometry.coordinates
      : null;

    const latitude = coordinates
      ? finiteCoordinate(coordinates[1])
      : finiteCoordinate(readFirst(properties, ["latitude", "lat", "Latitude", "LAT"]));
    const longitude = coordinates
      ? finiteCoordinate(coordinates[0])
      : finiteCoordinate(readFirst(properties, ["longitude", "lon", "lng", "Longitude", "LON", "LNG"]));

    if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return null;
    }

    const method = String(readFirst(properties, ["method", "feeder_method"]));
    const name = String(readFirst(properties, ["name", "site_name", "siteName", "title", "user", "id", "site_id"]) || `受信サイト ${index + 1}`);
    const typeValue = String(readFirst(properties, ["type", "site_type", "siteType", "feeder_mode", "feederMode", "mode"]));
    const type = typeValue || methodLabel(method);
    const frequency = String(readFirst(properties, ["frequency", "freq", "band"]) || "");
    const location = String(readFirst(properties, ["location", "region", "city", "country"]) || "");
    const description = String(readFirst(properties, ["description", "notes", "note"]) || "");
    const added = String(readFirst(properties, ["added", "added_at", "created_at"]) || "");
    const siteId = String(readFirst(properties, ["site_id", "siteId", "id"]) || "");

    return {
      added,
      description,
      frequency,
      latitude,
      location,
      longitude,
      name,
      siteId,
      type
    };
  }

  function parseCsv(text) {
    const rows = [];
    let field = "";
    let row = [];
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const next = text[index + 1];

      if (character === "\"") {
        if (quoted && next === "\"") {
          field += "\"";
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === "," && !quoted) {
        row.push(field);
        field = "";
      } else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && next === "\n") {
          index += 1;
        }
        row.push(field);
        if (row.some((value) => value.trim() !== "")) {
          rows.push(row);
        }
        row = [];
        field = "";
      } else {
        field += character;
      }
    }

    row.push(field);
    if (row.some((value) => value.trim() !== "")) {
      rows.push(row);
    }

    if (rows.length < 2) {
      return [];
    }

    const headers = rows.shift().map((header) => header.trim());
    return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()])));
  }

  function extractSites(payload) {
    let records;

    if (Array.isArray(payload)) {
      records = payload;
    } else if (payload && payload.type === "FeatureCollection" && Array.isArray(payload.features)) {
      records = payload.features;
    } else if (payload && payload.type === "Feature") {
      records = [payload];
    } else if (payload && Array.isArray(payload.sites)) {
      records = payload.sites;
    } else if (payload && Array.isArray(payload.data)) {
      records = payload.data;
    } else {
      throw new Error("対応する配列または GeoJSON FeatureCollection が見つかりません。");
    }

    const sites = records.map(normalizeRecord).filter(Boolean);
    if (records.length > 0 && sites.length === 0) {
      throw new Error("緯度・経度を持つ地点が見つかりません。");
    }
    return sites;
  }

  function pinColor(type) {
    const normalized = type.toLowerCase();
    if (normalized.includes("flightfeeder")) {
      return "#f29929";
    }
    if (normalized.includes("piaware")) {
      return "#13a5bf";
    }
    if (normalized.includes("demo") || normalized.includes("デモ")) {
      return "#7c5cff";
    }
    return "#226b91";
  }

  function popupRow(label, value) {
    if (!value) {
      return null;
    }
    const row = document.createElement("p");
    row.className = "popup-row";
    const heading = document.createElement("strong");
    heading.textContent = label;
    row.append(heading, document.createTextNode(value));
    return row;
  }

  function buildPopup(site) {
    const content = document.createElement("div");
    content.className = "popup";
    const title = document.createElement("h3");
    title.textContent = site.name;
    content.append(title);

    [
      popupRow("種別", site.type),
      popupRow("周波数", site.frequency),
      popupRow("地域", site.location),
      popupRow("追加日", site.added),
      popupRow("Site ID", site.siteId),
      popupRow("位置", `${site.latitude.toFixed(5)}, ${site.longitude.toFixed(5)}`),
      popupRow("メモ", site.description)
    ].filter(Boolean).forEach((row) => content.append(row));
    return content;
  }

  function createMarker(site) {
    const icon = L.divIcon({
      className: "site-pin",
      html: `<span style="--pin-color: ${pinColor(site.type)}"></span>`,
      iconAnchor: [10, 21],
      iconSize: [21, 21],
      popupAnchor: [0, -18]
    });
    return L.marker([site.latitude, site.longitude], { icon }).bindPopup(buildPopup(site));
  }

  function rebuildTypeOptions() {
    const selected = elements.typeSelect.value;
    const types = [...new Set(state.sites.map((site) => site.type))].sort((left, right) => left.localeCompare(right, "ja"));
    elements.typeSelect.replaceChildren(new Option("すべて", ""));
    types.forEach((type) => elements.typeSelect.add(new Option(type, type)));
    elements.typeSelect.value = types.includes(selected) ? selected : "";
  }

  function filterSites() {
    const query = elements.searchInput.value.trim().toLowerCase();
    const selectedType = elements.typeSelect.value;
    return state.sites.filter((site) => {
      const text = [site.name, site.type, site.frequency, site.location, site.description].join(" ").toLowerCase();
      return (!query || text.includes(query)) && (!selectedType || site.type === selectedType);
    });
  }

  function drawSites(fitBounds = false) {
    const visibleSites = filterSites();
    markerGroup.clearLayers();
    markerGroup.addLayers(visibleSites.map(createMarker));
    elements.visibleCount.textContent = visibleSites.length.toLocaleString("ja-JP");
    elements.totalCount.textContent = state.sites.length.toLocaleString("ja-JP");

    if (fitBounds && visibleSites.length > 0) {
      if (visibleSites.length === 1) {
        map.setView([visibleSites[0].latitude, visibleSites[0].longitude], 10);
      } else {
        const bounds = L.latLngBounds(visibleSites.map((site) => [site.latitude, site.longitude]));
        map.fitBounds(bounds, { padding: [38, 38], maxZoom: 11 });
      }
    }
  }

  function formatSourceTime(timestamp) {
    if (!timestamp) {
      return "--";
    }
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return timestamp;
    }
    return new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
  }

  function useSites(sites, source, sourceUpdatedAt = "") {
    state.sites = sites;
    state.source = source;
    state.sourceUpdatedAt = sourceUpdatedAt;
    elements.searchInput.value = "";
    elements.typeSelect.value = "";
    elements.sourceUpdated.dateTime = sourceUpdatedAt;
    elements.sourceUpdated.textContent = formatSourceTime(sourceUpdatedAt);
    rebuildTypeOptions();
    drawSites(true);

    if (sites.length === 0) {
      setStatus(`${source}: ピンはまだ登録されていません。`);
    } else {
      setStatus(`${source}: ${sites.length.toLocaleString("ja-JP")} 地点を表示しました。`, "success");
    }
  }

  async function loadUrl(url, label, isLive = false) {
    setStatus(`${label}を読み込み中...`);
    if (isLive) {
      elements.refreshButton.disabled = true;
    }
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      const updatedAt = payload && payload.sourceUpdatedAt ? payload.sourceUpdatedAt : "";
      useSites(extractSites(payload), label, updatedAt);
    } catch (error) {
      setStatus(`${label}を読み込めませんでした: ${error.message}`, "error");
    } finally {
      if (isLive) {
        elements.refreshButton.disabled = false;
      }
    }
  }

  async function loadFile(file) {
    setStatus(`${file.name} を読み込み中...`);
    try {
      const text = await file.text();
      const payload = file.name.toLowerCase().endsWith(".csv") ? parseCsv(text) : JSON.parse(text);
      useSites(extractSites(payload), file.name);
    } catch (error) {
      setStatus(`ファイルを読み込めませんでした: ${error.message}`, "error");
    }
  }

  elements.fileInput.addEventListener("change", (event) => {
    const [file] = event.target.files;
    if (file) {
      loadFile(file);
    }
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.add("is-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    elements.dropZone.addEventListener(eventName, (event) => {
      event.preventDefault();
      elements.dropZone.classList.remove("is-over");
    });
  });

  elements.dropZone.addEventListener("drop", (event) => {
    const [file] = event.dataTransfer.files;
    if (file) {
      loadFile(file);
    }
  });

  elements.dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      elements.fileInput.click();
    }
  });

  elements.refreshButton.addEventListener("click", () => loadUrl(`${LIVE_DATA_URL}?refresh=1`, "FlightAware 最新ピン", true));
  elements.demoButton.addEventListener("click", () => loadUrl(DEMO_DATA_URL, "デモデータ"));
  elements.localButton.addEventListener("click", () => loadUrl(LOCAL_DATA_URL, "保存データ"));
  elements.coverageEnabled.addEventListener("change", drawCoverage);
  elements.coverageAltitude.addEventListener("change", drawCoverage);
  elements.coverageLayerInputs.forEach((input) => input.addEventListener("change", drawCoverage));
  elements.searchInput.addEventListener("input", () => drawSites());
  elements.typeSelect.addEventListener("change", () => drawSites());
  elements.clearFilterButton.addEventListener("click", () => {
    elements.searchInput.value = "";
    elements.typeSelect.value = "";
    drawSites();
  });

  drawCoverage();
  loadUrl(LIVE_DATA_URL, "FlightAware ピンデータ", true);
})();
