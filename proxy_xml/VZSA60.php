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
// ▼▼▼ ここを変更 ▼▼▼
$target_url = '';
$search_title = 'アジア太平洋地上実況図'; // 検索タイトルを変更
$search_id_part = 'VZSA60';           // 検索IDを変更

$target_entries = $feed_xml->xpath('//atom:entry[atom:title[text()="' . $search_title . '"] and atom:id[contains(text(), "' . $search_id_part . '")]]/atom:link[@type="application/xml"]');
if (isset($target_entries[0]['href'])) {
    $target_url = (string)$target_entries[0]['href'];
} else {
    exit(json_encode(['error' => 'フィード内に' . $search_id_part . 'のURLが見つかりませんでした。']));
}

// --- ステップ3: 対象XMLファイルの読み込み ---
$data_xml_content = @file_get_contents($target_url);
if (!$data_xml_content) { 
    exit(json_encode(['error' => $search_id_part . 'の詳細データを取得できませんでした。'])); 
}

$data_xml = simplexml_load_string($data_xml_content);
if (!$data_xml) { 
    exit(json_encode(['error' => $search_id_part . 'のXML解析に失敗しました。'])); 
}

// --- ステップ4: 時刻とItem要素の解析 ---
$data_xml->registerXPathNamespace('b', 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/');
$data_xml->registerXPathNamespace('eb', 'http://xml.kishou.go.jp/jmaxml1/elementBasis1/');

$report_time_nodes = $data_xml->xpath('//b:MeteorologicalInfos/b:MeteorologicalInfo/b:DateTime');
$report_time = '';
if (!empty($report_time_nodes)) {
    $report_time = (string)$report_time_nodes[0];
}

$weather_features = [];
$items = $data_xml->xpath('//b:MeteorologicalInfos/b:MeteorologicalInfo/b:Item');

// 名前空間のURIを定義
$ns_b = 'http://xml.kishou.go.jp/jmaxml1/body/meteorology1/';
$ns_eb = 'http://xml.kishou.go.jp/jmaxml1/elementBasis1/';

foreach ($items as $item) {
    foreach ($item->children($ns_b)->Kind as $kind) {
        foreach ($kind->children($ns_b)->Property as $prop) {
            $type = (string)$prop->children($ns_b)->Type;

            switch ($type) {
                case '等圧線':
                    foreach ($prop->children($ns_b)->IsobarPart as $part) {
                        $pressure = (string)$part->children($ns_eb)->Pressure;
                        $line_string = (string)$part->children($ns_eb)->Line;
                        $coords = parseCoordinates($line_string);
                        if (!empty($coords)) {
                            $weather_features[] = ['type' => 'isobar', 'pressure' => (int)$pressure, 'coordinates' => $coords];
                        }
                    }
                    break;
                case '高気圧': case '低気圧': case '台風': case '熱帯低気圧':
                    foreach ($prop->children($ns_b)->CenterPart as $part) {
                        $pressureNode = $part->children($ns_eb)->Pressure;
                        $coordNode = $part->children($ns_eb)->Coordinate;
                        $coords = parseCoordinates((string)$coordNode);
                        if (!empty($coords) && isset($pressureNode[0])) {
                            $weather_features[] = [
                                'type' => 'pressure_system', 'name' => $type, 'pressure' => (int)$pressureNode,
                                'unit' => (string)$pressureNode->attributes()->unit, 'coordinates' => $coords[0]
                            ];
                        }
                    }
                    break;
                case '温暖前線': case '寒冷前線': case '停滞前線': case '閉塞前線':
                     foreach ($prop->children($ns_b)->CoordinatePart as $part) {
                        $line_string = (string)$part->children($ns_eb)->Line;
                        $coords = parseCoordinates($line_string);
                        if (!empty($coords)) {
                            $weather_features[] = ['type' => 'front', 'name' => $type, 'coordinates' => $coords];
                        }
                    }
                    break;
            }
        }
    }
}

// --- ステップ5: 最終的なJSONを出力 ---
$response_data = [
    'reportTime' => $report_time,
    'features' => $weather_features
];

echo json_encode($response_data, JSON_UNESCAPED_UNICODE);

?>
