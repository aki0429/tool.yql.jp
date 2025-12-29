<?php
// 出力形式をJSONに設定
header('Content-Type: application/json; charset=utf-8');

/**
 * 気象庁の座標文字列（緯度経度）をパースして配列に変換する関数
 */
function parseCoordinates($line_string) {
    $coords = [];
    $pairs = explode('/', trim((string)$line_string));
    foreach ($pairs as $pair) {
        if (!empty($pair)) {
            if (preg_match('/([+\-]\d{1,3}(?:\.\d{1,2})?)([+\-]\d{1,3}(?:\.\d{1,2})?)/', $pair, $matches)) {
                $coords[] = [(float)$matches[1], (float)$matches[2]];
            }
        }
    }
    return $coords;
}

// --- ステップ1: JMAフィードの読み込み ---
$feed_url = "https://www.data.jma.go.jp/developer/xml/feed/regular.xml";
$feed_xml_content = @file_get_contents($feed_url);
if (!$feed_xml_content) { 
    exit(json_encode(['error' => 'JMAフィードを取得できませんでした。'])); 
}

$feed_xml = simplexml_load_string($feed_xml_content);
if (!$feed_xml) { 
    exit(json_encode(['error' => 'JMAフィードのXML解析に失敗しました。'])); 
}
$feed_xml->registerXPathNamespace('atom', 'http://www.w3.org/2005/Atom');

// --- ステップ2: 目的のURLを検索 ---
$target_url = '';
$target_entries = $feed_xml->xpath('//atom:entry[atom:title[text()="地上実況図"] and atom:id[contains(text(), "VZSA50")]]/atom:link[@type="application/xml"]');
if (isset($target_entries[0]['href'])) {
    $target_url = (string)$target_entries[0]['href'];
} else {
    exit(json_encode(['error' => 'フィード内にVZSA50のURLが見つかりませんでした。']));
}

// --- ステップ3: 対象XMLファイルの読み込み ---
$data_xml_content = @file_get_contents($target_url);
if (!$data_xml_content) { 
    exit(json_encode(['error' => 'VZSA50の詳細データを取得できませんでした。'])); 
}

$data_xml = simplexml_load_string($data_xml_content);
if (!$data_xml) { 
    exit(json_encode(['error' => 'VZSA50のXML解析に失敗しました。'])); 
}

// --- ステップ4: Item要素の解析 ---
$data_xml->registerXPathNamespace('b', 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/');
$items = $data_xml->xpath('//b:MeteorologicalInfo/b:Item');

$weather_features = [];

foreach ($items as $item) {
    // ▼▼▼ 改善された解析ロジック ▼▼▼
    // 各Item要素に、必要な名前空間を都度登録する
    $item->registerXPathNamespace('b', 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/');
    $item->registerXPathNamespace('eb', 'http://xml.kishou.go.jp/jmaxml1/elementBasis1/');

    // --- 等圧線の解析 ---
    $isobar_parts = $item->xpath('.//b:Property[b:Type="等圧線"]/b:IsobarPart');
    foreach ($isobar_parts as $part) {
        $eb_children = $part->children('eb', true); // 'eb'名前空間の子要素を取得
        $pressure = (string)$eb_children->Pressure;
        $line_string = (string)$eb_children->Line;
        $coords = parseCoordinates($line_string);
        if (!empty($coords)) { 
            $weather_features[] = ['type' => 'isobar', 'pressure' => (int)$pressure, 'coordinates' => $coords]; 
        }
    }

    // --- 高気圧・低気圧などの解析 ---
    $pressure_system_types = ['高気圧', '低気圧', '台風', '熱帯低気圧'];
    foreach ($pressure_system_types as $type) {
        $center_parts = $item->xpath('.//b:Property[b:Type="' . $type . '"]/b:CenterPart');
        foreach ($center_parts as $part) {
            $eb_children = $part->children('eb', true);
            $pressureNode = $eb_children->Pressure;
            $coordNode = $eb_children->Coordinate;
            $coords = parseCoordinates((string)$coordNode);
            if (!empty($coords)) { 
                $weather_features[] = [
                    'type' => 'pressure_system', 'name' => $type, 'pressure' => (int)$pressureNode, 
                    'unit' => (string)$pressureNode['unit'], 'coordinates' => $coords[0]
                ]; 
            }
        }
    }

    // --- 前線の解析 ---
    $front_types = ['温暖前線', '寒冷前線', '停滞前線', '閉塞前線'];
    foreach ($front_types as $type) {
        $front_parts = $item->xpath('.//b:Property[b:Type="' . $type . '"]/b:CoordinatePart');
        foreach ($front_parts as $part) {
            $eb_children = $part->children('eb', true);
            $line_string = (string)$eb_children->Line;
            $coords = parseCoordinates($line_string);
            if (!empty($coords)) { 
                $weather_features[] = ['type' => 'front', 'name' => $type, 'coordinates' => $coords]; 
            }
        }
    }
}

// --- ステップ5: 最終的なJSONを出力 ---

// デバッグモードの判定
$isDebug = isset($_GET['debug']) && $_GET['debug'] == '1';

if ($isDebug && empty($weather_features) && count($items) > 0) {
    // デバッグモードがON、かつ、データが空だった場合に詳細情報を出力
    $debug_items = [];
    for ($i = 0; $i < min(count($items), 5); $i++) {
        $debug_items[] = $items[$i]->asXML();
    }

    exit(json_encode([
        'error' => '描画可能な気象データが見つかりませんでした。',
        'reason' => 'XMLの構造が想定と異なっているか、解析ロジックが対応していない可能性があります。',
        'target_url' => $target_url,
        'item_count_in_xml' => count($items),
        'item_samples' => $debug_items
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
}

// 通常時、またはデータが正常に取得できた場合は、結果を出力
echo json_encode($weather_features, JSON_UNESCAPED_UNICODE);

?>
