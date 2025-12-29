<?php
/**
 * 気象庁の情報フィード(extra.xml)から「気象警報・注意報(VPWW54)」の情報を
 * URLパラメータ(?limit=N)で指定された件数分だけ取得し、JSONで出力するスクリプト
 */

// 総合情報フィードのURL
$listUrl = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml';

// 検索したい情報のキーワード (URLに含まれる文字列)
$targetKeyword = 'VPWW54';

// --- ?limit パラメータから取得件数を決定 ---
// パラメータが存在すればその値を整数として使い、なければデフォルトで5件とする
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 1;

// もしlimitに0以下の数値が指定された場合は、安全のため5件に戻す
if ($limit < 1) {
    $limit = 5;
}

try {
    // 総合情報の一覧XMLを取得
    $listXmlString = @file_get_contents($listUrl);
    if ($listXmlString === false) {
        throw new Exception('総合情報の一覧XML (extra.xml) が取得できませんでした。');
    }

    // 一覧XMLをパース
    $listXml = new SimpleXMLElement($listXmlString);
    
    // 見つかったVPWW54の情報を一時的に格納する配列
    $targetEntries = [];

    // --- 1. extra.xmlからVPWW54の情報をすべて探し出す ---
    foreach ($listXml->entry as $entry) {
        $linkUrl = (string)$entry->link['href'];

        // linkのURLに $targetKeyword ('VPWW54') が含まれているかチェック
        if (strpos($linkUrl, $targetKeyword) !== false) {
            // 見つかったら、entryオブジェクト全体を配列に追加
            $targetEntries[] = $entry;
        }
    }

    if (empty($targetEntries)) {
        throw new Exception('一覧から「' . $targetKeyword . '」を含む情報が見つかりませんでした。');
    }

    // --- 2. 見つかった情報から、limitで指定された件数分だけを切り出す ---
    $limitedEntries = array_slice($targetEntries, 0, $limit);

    $results = [];
    $counter = 1;

    // --- 3. 件数制限された情報について、一つずつ詳細を取得する ---
    foreach ($limitedEntries as $entry) {
        $title = (string)$entry->title;
        $detailUrl = (string)$entry->id;

        // 詳細情報を取得
        $detailXmlString = @file_get_contents($detailUrl);
        
        $detailObject = null;
        $fetchError = null;

        if ($detailXmlString === false) {
            $fetchError = '詳細情報のXMLを取得できませんでした。';
        } else {
            $detailObject = simplexml_load_string($detailXmlString);
        }
        
        $results[] = [
            'number' => $counter,
            'title' => $title,
            'detail_url' => $detailUrl,
            'error' => $fetchError,
            'detail' => $detailObject
        ];
        
        $counter++;
    }

    // JSONに変換して出力
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($results, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);

} catch (Exception $e) {
    // エラー処理
    header('Content-Type: application/json; charset=utf-8', true, 500);
    echo json_encode([
        'error' => true,
        'message' => $e->getMessage()
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

?>