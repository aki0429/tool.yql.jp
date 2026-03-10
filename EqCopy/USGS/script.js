//このスクリプトを読み込んだらDevToolに取得中と表示
console.log("USGS地震情報を取得中...")

// 方角コードを日本語に変換
function translateDirection(dir) {
    const map = {
        N: "北",
        S: "南",
        E: "東",
        W: "西",
        NE: "北東",
        NW: "北西",
        SE: "南東",
        SW: "南西",
        NNE: "北北東",
        ENE: "東北東",
        ESE: "東南東",
        SSE: "南南東",
        SSW: "南南西",
        WSW: "西南西",
        WNW: "西北西",
        NNW: "北北西"
    };
    return map[dir] || dir;
}

const usgsRegionCacheKey = "usgs_region_names_v1";
const usgsRegionCacheHours = 24;
let usgsRegionReplacements = [];

function buildIntlRegionMap() {
    const map = {};
    if (typeof Intl === "undefined" || !Intl.DisplayNames || !Intl.supportedValuesOf) {
        return map;
    }
    try {
        const en = new Intl.DisplayNames(["en"], { type: "region" });
        const ja = new Intl.DisplayNames(["ja"], { type: "region" });
        Intl.supportedValuesOf("region").forEach(code => {
            const enName = en.of(code);
            const jaName = ja.of(code);
            if (enName && jaName) {
                map[enName.toLowerCase()] = jaName;
            }
        });
    } catch (e) {
        return {};
    }
    return map;
}

const intlRegionMap = buildIntlRegionMap();

const manualRegionMap = {
    russia: "ロシア",
    japan: "日本",
    china: "中国",
    korea: "韓国",
    "north korea": "北朝鮮",
    "south korea": "韓国",
    usa: "アメリカ",
    "u.s.": "アメリカ",
    "u.s.a.": "アメリカ",
    "united states": "アメリカ",
    mexico: "メキシコ",
    canada: "カナダ",
    chile: "チリ",
    peru: "ペルー",
    philippines: "フィリピン",
    indonesia: "インドネシア",
    turkey: "トルコ",
    greece: "ギリシャ",
    italy: "イタリア",
    spain: "スペイン",
    france: "フランス",
    "new zealand": "ニュージーランド",
    australia: "オーストラリア"
};

function translateRegionName(name) {
    if (!name) return name;
    const normalized = name.trim();
    const lower = normalized.toLowerCase();

    if (intlRegionMap[lower]) return intlRegionMap[lower];
    if (manualRegionMap[lower]) return manualRegionMap[lower];

    let result = normalized;
    result = result
        .replace(/\bNorth\b/ig, "北")
        .replace(/\bSouth\b/ig, "南")
        .replace(/\bEast\b/ig, "東")
        .replace(/\bWest\b/ig, "西")
        .replace(/\bCentral\b/ig, "中央")
        .replace(/\bIslands\b/ig, "諸島")
        .replace(/\bIsland\b/ig, "島")
        .replace(/\bPeninsula\b/ig, "半島")
        .replace(/\bCoast\b/ig, "沿岸")
        .replace(/\bOffshore\b/ig, "沖")
        .replace(/\bSea\b/ig, "海")
        .replace(/\bGulf\b/ig, "湾")
        .replace(/\bBay\b/ig, "湾")
        .replace(/\bOcean\b/ig, "洋")
        .replace(/\bRegion\b/ig, "地域")
        .replace(/\bMt\.\b/ig, "山")
        .replace(/\bMount\b/ig, "山")
        .replace(/\bLake\b/ig, "湖");

    return result;
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractRegionFromPlace(place) {
    if (!place) return null;
    const normalized = place.trim();
    const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$/i);
    const core = match ? match[3] : normalized;
    const parts = core.split(",").map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 1];
    return null;
}

function buildUsgsRegionReplacements(regionNames) {
    const map = {};
    regionNames.forEach(name => {
        const translated = translateRegionName(name);
        if (translated && translated !== name) {
            map[name] = translated;
        }
    });
    usgsRegionReplacements = Object.entries(map)
        .map(([from, to]) => ({ from, to }))
        .sort((a, b) => b.from.length - a.from.length);
}

function replaceRegionsFromUsgs(text) {
    if (!usgsRegionReplacements.length) return text;
    let result = text;
    usgsRegionReplacements.forEach(({ from, to }) => {
        const re = new RegExp(escapeRegExp(from), "ig");
        result = result.replace(re, to);
    });
    return result;
}

function loadUsgsRegionNames() {
    try {
        const cached = localStorage.getItem(usgsRegionCacheKey);
        if (cached) {
            const parsed = JSON.parse(cached);
            const ageHours = (Date.now() - parsed.timestamp) / (1000 * 60 * 60);
            if (Array.isArray(parsed.names) && ageHours <= usgsRegionCacheHours) {
                buildUsgsRegionReplacements(parsed.names);
                return;
            }
        }
    } catch (e) {
        console.warn("USGS地域キャッシュの読み込みに失敗:", e);
    }

    $.getJSON("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson", function(data) {
        const regionSet = new Set();
        if (data && Array.isArray(data.features)) {
            data.features.forEach(feature => {
                const place = feature?.properties?.place;
                const region = extractRegionFromPlace(place);
                if (region) regionSet.add(region);
            });
        }
        const names = Array.from(regionSet).slice(0, 800);
        buildUsgsRegionReplacements(names);
        try {
            localStorage.setItem(usgsRegionCacheKey, JSON.stringify({
                timestamp: Date.now(),
                names
            }));
        } catch (e) {
            console.warn("USGS地域キャッシュの保存に失敗:", e);
        }
    }).fail(function(jqXHR, textStatus, errorThrown) {
        console.warn("USGS地域データの取得に失敗:", textStatus, errorThrown);
    });
}

loadUsgsRegionNames();

// USGSのplace文字列をざっくり日本語化
function translatePlace(place) {
    if (!place) return "場所不明";

    const normalized = place.trim();
    const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*km\s+([NSEW]{1,3})\s+of\s+(.+)$/i);
    if (!match) return normalized;

    const distance = match[1];
    const dir = translateDirection(match[2].toUpperCase());
    let location = match[3].trim();

    // "City, Country" -> "Country・City" の並び替え
    const parts = location.split(",").map(part => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
        const countryKey = parts[parts.length - 1].toLowerCase();
        const translatedCountry = translateRegionName(countryKey) || parts[parts.length - 1];
        parts[parts.length - 1] = translatedCountry;
    }
    if (parts.length >= 2) {
        location = `${parts.slice(1).join("・")}・${parts[0]}`;
    }

    // ハイフンは中黒に置換（読みやすさ優先）
    location = location.replace(/-/g, "・");

    // USGS地域データから置換を試みる
    location = replaceRegionsFromUsgs(location);

    return `${location}の${dir}${distance}km`;
}

// USGS APIから地震情報を取得
// 過去1日間のM4.5以上の地震を取得
$.getJSON("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson", function(data) {
    if (data.features && data.features.length > 0) {
        // 最新の地震情報を取得
        const earthquake = data.features[0];
        const properties = earthquake.properties;
        
        // 地震情報の変換
        const magnitude = properties.mag.toFixed(1);
        const place = translatePlace(properties.place);
        const hasEnglishRegion = /[A-Za-z]/.test(place);
        const time = new Date(properties.time).toLocaleString('ja-JP');
        const depth = earthquake.geometry.coordinates[2].toFixed(1); // 深さはgeometry.coordinates[2]から取得
        const tsunamiAlert = properties.tsunami === 1 ? "津波の可能性があります。" : "この地震による津波の心配はありません。";
        const englishRegionNotice = hasEnglishRegion
            ? "\n※地域名が英語のままの場合は運営担当者X:akki_0429_netまでお知らせください。"
            : "";
        
        // 情報テキストの作成
        const info = `地震についての情報です。\n${time}頃、${place}で地震がありました。\n` +
                    `マグニチュード: ${magnitude}\n` +
                    `震源の深さ: ${depth}km\n` +
                `${tsunamiAlert}${englishRegionNotice}`;
        
        document.getElementById('eqinfo').innerText = info;
    } else {
        document.getElementById('eqinfo').innerText = "最近の大きな地震情報はありません。";
    }
}).fail(function(jqXHR, textStatus, errorThrown) {
    console.error("地震情報の取得に失敗しました:", textStatus, errorThrown);
    document.getElementById('eqinfo').innerText = "地震情報の取得に失敗しました。";
});

//地震情報が受信できたらDevToolに取得完了と表示する
console.log("地震情報取得完了。")

//地震情報を受信して2秒後DevToolに待機状態と表示する
setTimeout(function(){
    console.log("待機モードに入ります。")
}, 2*1000)

//50秒カウントしたらDelToolに再読み込みを促す
setTimeout(function(){
    console.log("50秒が経過しました。\n情報を更新するためにまもなく再読込します。")
}, 50*1000)

//1分たったら自動的に再読み込みする
setTimeout(function(){
    window.location.href = 'index.html';
}, 60*1000);

document.getElementById('copy_btn').addEventListener('click', function() {
    const textDiv = document.getElementById('eqinfo');
    const textToCopy = textDiv.innerText; // 改行を保持したテキストを取得

    // テキストをクリップボードにコピー
    navigator.clipboard.writeText(textToCopy).then(() => {
        alert('地震情報をクリップボードにコピーしました。');
    }).catch(err => {
        alert('クリップボードにコピーできませんでした。:' + err);
    });
});
function postToX() {
    // eqinfoの内容を取得
    const eqinfoElement = document.getElementById("eqinfo");
    const eqinfo = eqinfoElement.innerText || eqinfoElement.textContent;

    // ツイート用のURLを生成
    const baseUrl = "https://x.com/share?";
    const tweetText = eqinfo; // eqinfoをツイート内容に設定
    const hashtags = "地震,情報"; // ハッシュタグ

    const completeUrl = `${baseUrl}&text=${encodeURIComponent(tweetText)}&hashtags=${encodeURIComponent(hashtags)}`;

    // 生成されたURLをログに出力
    console.log(completeUrl);

    // ツイート画面を開く
    window.open(completeUrl, '_blank');
}