<?php
/**
 * 【指定URL対応版】
 * 気象庁のextra.xmlから「記録的短時間大雨情報」をすべて取得してJSONで返すAPI
 */

// --- ① ヘッダー設定 ---
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');


// --- ② メイン処理 ---
try {
    // 【ご指定のURL】特別警報・警報・注意報のフィード
    $feedUrl = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml';

    // file_get_contentsでフィードのXMLデータを取得
    $feedXmlString = @file_get_contents($feedUrl);
    if ($feedXmlString === false) {
        throw new Exception('気象庁の防災情報フィード(' . $feedUrl . ')を取得できませんでした。');
    }

    // 取得したXML文字列をSimpleXMLElementオブジェクトに変換
    $feedXml = new SimpleXMLElement($feedXmlString);
    
    // --- ③ 取得した情報を格納するための配列を用意 ---
    $rainfall_reports = [];

    // --- ④ フィードの全エントリをループし、「記録的短時間大雨情報」を探す ---
    foreach ($feedXml->entry as $entry) {
        // <title>に「記録的短時間大雨情報」が含まれているかチェック
        if (strpos($entry->title, '記録的短時間大雨情報') !== false) {
            
            // 該当情報の詳細XMLのURLを取得
            $targetUrl = (string)$entry->id; // atomフィードではidタグが詳細URL
            if (empty($targetUrl)) {
                 $targetUrl = (string)$entry->link['href']; // RSSフィード形式の場合
            }
            
            $detailXmlString = @file_get_contents($targetUrl);

            // 詳細XMLの取得に失敗した場合は、このエントリをスキップして次に進む
            if ($detailXmlString === false) {
                continue; 
            }

            // 詳細XMLをオブジェクトに変換
            $xml = simplexml_load_string($detailXmlString);

            // --- ⑤ 詳細XMLから必要な情報を抽出 ---
            $reportDateTime = (string)$xml->Control->DateTime;
            $publishingOffice = (string)$xml->Control->PublishingOffice;
            $headline = (string)$xml->Head->Headline->Text;
            
            $details = [];
            if (isset($xml->Body->Comments->WarningComment)) {
                foreach($xml->Body->Comments->WarningComment as $comment) {
                    if((string)$comment->attributes()->codeType === 'RecordShortTermHeavyRain') {
                         $details[] = (string)$comment->Text;
                    }
                }
            }

            // --- ⑥ 取得した情報を一つのオブジェクトにまとめ、最終結果の配列に追加 ---
            $rainfall_reports[] = [
                'publishingOffice' => $publishingOffice,
                'reportDateTime' => $reportDateTime,
                'headline' => $headline,
                'details' => $details,
                'sourceXml' => $targetUrl // どのXMLから取得したかの情報
            ];
        }
    }

    // --- ⑦ 取得結果に応じたレスポンスを作成 ---
    if (empty($rainfall_reports)) {
        $response = [
            'status' => 'ok',
            'message' => '指定されたフィード(' . $feedUrl . ')内に、現在発表されている記録的短時間大雨情報はありません。',
            'data' => []
        ];
    } else {
        $response = [
            'status' => 'ok',
            'message' => count($rainfall_reports) . '件の記録的短時間大雨情報を取得しました。',
            'data' => $rainfall_reports
        ];
    }

} catch (Exception $e) {
    // --- ⑧ エラー発生時の処理 ---
    http_response_code(500);
    $response = [
        'status' => 'error',
        'message' => $e->getMessage(),
        'data' => null
    ];
}

// --- ⑨ 最終的な結果をJSON形式で出力 ---
echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
?>
