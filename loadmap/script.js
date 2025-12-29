// ====================== 設定 ======================
const BASE_URL = "https://www.road-info-prvs.mlit.go.jp/roadinfo/backup/";
const BACKUP_CODE = "ZSGyyBcWvTAH0ZzV"; // 固定ディレクトリコード
const JSON_RANGE = Array.from({ length: 10 }, (_, i) => 81 + i); // 81〜90
const PROXY = "proxy.php"; // 同一ディレクトリ内にある proxy.php

// ====================== マップ初期化 ======================
const map = L.map("map").setView([43.06417, 141.34694], 7); // 北海道中央
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

// ピン管理用
let markers = [];

// ====================== JSON取得関数 ======================
async function fetchAllJson() {
  const timestamp = getBackupTimestamp();
  const pins = [];

  for (const num of JSON_RANGE) {
    const target = `${BASE_URL}${timestamp}/${BACKUP_CODE}/ImageList/${num}.json`;
    const proxied = `${PROXY}?url=${encodeURIComponent(target)}`;
    console.log("📥 Fetch:", target);

    try {
      const res = await fetch(proxied);
      if (!res.ok) throw new Error(res.status);
      const json = await res.json();
      pins.push(...parseJsonData(json));
    } catch (e) {
      console.warn(`❌ JSON ${num}取得失敗:`, e);
    }
  }

  return pins;
}

// ====================== JSON解析 ======================
function parseJsonData(json) {
  const points = [];
  for (const key in json) {
    const list = json[key];
    list.forEach((item) => {
      const data = Object.values(item)[0];
      if (!data?.gis_point) return;

      const [lon, lat] = data.gis_point.map(parseFloat);
      const info = {
        name: data.image_name,
        city: data.cities_name,
        area: data.area_name,
        lat,
        lon,
        files: data.fileList.map(f => ({
          time: f.get_datetime,
          file: f.file
        }))
      };
      points.push(info);
    });
  }
  return points;
}

// ====================== ピン描画 ======================
function showPins(pins) {
  // 既存ピン削除
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  pins.forEach((p) => {
    const marker = L.marker([p.lat, p.lon]).addTo(map);
    marker.bindPopup(`<b>${p.name}</b><br>${p.city}<br>${p.area}<br><button onclick="showImages(${JSON.stringify(p).replace(/"/g, '&quot;')})">画像を見る</button>`);
    markers.push(marker);
  });
}

// ====================== 画像表示 ======================
function showImages(point) {
  const container = document.getElementById("image-container");
  container.innerHTML = "";

  const title = document.createElement("h3");
  title.textContent = `${point.name} (${point.city})`;
  container.appendChild(title);

  point.files.forEach(f => {
    const imgBox = document.createElement("div");
    imgBox.className = "img-box";

    const img = document.createElement("img");
    img.src = `${BASE_URL}${f.file}`;
    img.alt = point.name;

    const label = document.createElement("label");
    label.className = "check-label";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "crawl-check";
    checkbox.dataset.url = `${BASE_URL}${f.file}`;
    label.appendChild(checkbox);
    label.append(" クロール対象");

    imgBox.appendChild(img);
    imgBox.appendChild(document.createElement("br"));
    imgBox.appendChild(label);
    container.appendChild(imgBox);
  });

  // 右下にクロールボタン
  const crawlBtn = document.createElement("button");
  crawlBtn.id = "crawl-btn";
  crawlBtn.textContent = "✅ 選択した画像をクロールします";
  crawlBtn.onclick = crawlSelectedImages;
  container.appendChild(crawlBtn);

  // 中央にスクロール
  container.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ====================== クロール処理（チェック画像） ======================
function crawlSelectedImages() {
  const checked = document.querySelectorAll(".crawl-check:checked");
  if (checked.length === 0) {
    alert("画像が選択されていません。");
    return;
  }

  const urls = Array.from(checked).map(c => c.dataset.url);
  console.log("🕷️ クロール開始:", urls);

  alert(`${urls.length} 件の画像をクロールします（仮処理）。`);
  // ここに実際のクロール処理を書く（例: fetchで保存リクエストなど）
}

// ====================== バックアップ時刻計算（15分前の5分単位） ======================
function getBackupTimestamp() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - 15); // 15分前
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const minute = now.getMinutes();
  const floor5 = Math.floor(minute / 5) * 5;
  const mm = String(floor5).padStart(2, "0");
  return `${y}${m}${d}${h}${mm}00`;
}

// ====================== 初期化 ======================
(async () => {
  const pins = await fetchAllJson();
  showPins(pins);
})();
console.log(target);
