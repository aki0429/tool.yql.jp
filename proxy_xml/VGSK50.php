<?php
// ========== 設定 ==========
// 取得する情報の最大件数 (0にすると全て取得)
$limit = 3; 
// ========================

// 対象とする気象庁の防災情報XMLフィードのURL
$xmlUrl = 'https://www.data.jma.go.jp/developer/xml/feed/regular.xml';

// --- ユーティリティ関数 (変更不要) ---

/**
 * XMLノードを再帰的にたどり、PHPの配列に変換する関数
 */
function domNodeToArray($node) {
    $output = [];
    switch ($node->nodeType) {
        case XML_CDATA_SECTION_NODE:
        case XML_TEXT_NODE:
            return trim($node->textContent);
        case XML_ELEMENT_NODE:
            for ($i = 0, $m = $node->childNodes->length; $i < $m; $i++) {
                $child = $node->childNodes->item($i);
                $v = domNodeToArray($child);
                if (isset($child->tagName)) {
                    $t = $child->tagName;
                    if (!isset($output[$t])) {
                        $output[$t] = [];
                    }
                    $output[$t][] = $v;
                } elseif ($v || $v === '0') {
                    $output = (string) $v;
                }
            }
            if ($node->attributes->length && !is_array($output)) {
                $output = ['#text' => $output];
            }
            if (is_array($output)) {
                foreach ($output as $t => $v) {
                    if (is_array($v) && count($v) == 1) {
                        $output[$t] = $v[0];
                    }
                }
                if ($node->attributes->length) {
                    $a = [];
                    foreach ($node->attributes as $attrName => $attrNode) {
                        $a[$attrName] = (string) $attrNode->value;
                    }
                    $output['@attributes'] = $a;
                }
            }
            break;
    }
    return $output;
}

/**
 * 指定されたURLからコンテンツを取得する関数
 */
function fetchContent($url) {
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 5); // 接続タイムアウト
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);      // 全体タイムアウト
    $content = curl_exec($ch);
    curl_close($ch);
    return $content;
}

// --- メイン処理 ---

// 1. まずは「目次」となるフィードを取得
$feedXmlString = fetchContent($xmlUrl);
if (!$feedXmlString) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => '気象庁XMLフィードの取得に失敗しました。']);
    exit;
}

$doc = new DOMDocument();
@$doc->loadXML($feedXmlString);
$arrayData = domNodeToArray($doc->documentElement);

// 2. 必要な情報を抽出
$extractedInfo = [];
$entries = $arrayData['feed']['entry'] ?? [];

if (!empty($entries) && !is_array(current($entries))) {
    $entries = [$entries];
}

// 取得件数に制限をかける
if ($limit > 0) {
    $entries = array_slice($entries, 0, $limit);
}

// 3. 各情報の詳細XMLを読みに行く
foreach ($entries as $entry) {
    $detailXmlUrl = $entry['link']['@attributes']['href'] ?? null;

    $report = [
        'title' => $entry['title'] ?? 'タイトルなし',
        'updated' => $entry['updated'] ?? '不明',
        'author' => $entry['author']['name'] ?? '不明',
        'summary' => (string)($entry['content']['#text'] ?? $entry['content'] ?? ''),
        'detail_xml_url' => $detailXmlUrl,
        'report_body' => null // 詳細情報を格納する場所を準備
    ];

    // ▼▼▼ ここからが新しい処理 ▼▼▼
    // 詳細XMLのURLが存在する場合のみ、その中身を取得しにいく
    if ($detailXmlUrl) {
        $detailXmlString = fetchContent($detailXmlUrl);
        if ($detailXmlString) {
            $detailDoc = new DOMDocument();
            if (@$detailDoc->loadXML($detailXmlString)) {
                $detailArray = domNodeToArray($detailDoc->documentElement);
                
                // 詳細情報の本文を抽出 (気象庁XMLの典型的な構造に対応)
                // Report -> Body -> Comment -> Text の中身を取得
                $report['report_body'] = $detailArray['Report']['Body']['Comment']['Text'] ?? '詳細本文の取得に失敗しました。';

            } else {
                $report['report_body'] = '詳細XMLの解析に失敗しました。';
            }
        } else {
            $report['report_body'] = '詳細XMLの取得に失敗しました。';
        }
    }
    // ▲▲▲ ここまでが新しい処理 ▲▲▲

    $extractedInfo[] = $report;
}

// 4. 最終的な結果をJSONで出力
$json = json_encode($extractedInfo, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

header('Content-Type: application/json; charset=utf-8');
echo $json;

?>