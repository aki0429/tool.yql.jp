<?php
/**
 * 気象庁 土砂災害警戒情報 自動取得・解析スクリプト
 *
 * フィード内の全ての対象情報を取得し、それぞれに一意の番号を付与して出力します。
 * 複雑な名前空間問題を根本的に解決するため、解析前に名前空間を除去する方式を採用。
 * これにより、気象庁XMLのあらゆるパターンに安定して対応します。
 *
 * @version 3.1 (Multi-Entry Engine)
 * @author Gemini
 */

// --- 設定 ---
const FEED_URL = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml';
const TARGET_ID_PART = 'VXWW50'; // 探したい情報の種類（土砂災害警戒情報）

// --- メイン処理 ---
try {
    // ステップ1: フィードから目的のXMLデータURLを「全て」取得
    $targetXmlUrls = fetchAllDataUrls(FEED_URL, TARGET_ID_PART);

    $allResults = [];
    // ステップ2: 取得した全URLをループ処理
    foreach ($targetXmlUrls as $index => $url) {
        // ステップ2a: 取得したURLからXMLデータを取得
        $xmlContent = fetchXmlContent($url, TARGET_ID_PART);

        // ステップ2b: XMLデータを解析し、構造化された配列に変換
        $parsedData = parseLandslideInfoXml($xmlContent);

        // ★★★ 機能追加: 各データに番号とソースURLを追加 ★★★
        $parsedData['entry_number'] = $index + 1; // 1から始まる番号を付与
        $parsedData['source_url'] = $url;         // どのURLのデータか明記

        $allResults[] = $parsedData;
    }

    // ステップ3: 成功レスポンスをJSONで出力
    sendJsonResponse($allResults);

} catch (Exception $e) {
    // エラー発生時の処理
    sendJsonResponse(['error' => $e->getMessage()], $e->getCode() ?: 500);
}


// --- 関数定義 ---

/**
 * 気象庁のフィードを読み込み、目的のデータURLを「全て」取得します。
 * @return array 取得したURLの配列
 */
function fetchAllDataUrls(string $feedUrl, string $idPart): array
{
    $feedXmlContent = @file_get_contents($feedUrl);
    if (!$feedXmlContent) {
        throw new Exception('気象庁のフィードを取得できませんでした。', 503);
    }

    $feedXml = simplexml_load_string($feedXmlContent);
    if (!$feedXml) {
        throw new Exception('気象庁フィードのXML解析に失敗しました。', 500);
    }
    $feedXml->registerXPathNamespace('atom', 'http://www.w3.org/2005/Atom');

    $xpath = sprintf('//atom:entry[contains(atom:id, "%s")]/atom:link[@type="application/xml"]', $idPart);
    $entries = $feedXml->xpath($xpath);

    $urls = [];
    if ($entries) {
        foreach ($entries as $entry) {
            $urls[] = (string)$entry['href'];
        }
    }

    if (empty($urls)) {
        throw new Exception("フィード内に '${idPart}' のURLが見つかりませんでした。", 404);
    }

    return $urls;
}

/**
 * 指定されたURLからXMLコンテンツを取得します。
 */
function fetchXmlContent(string $url, string $idPart): string
{
    $xmlContent = @file_get_contents($url);
    if (!$xmlContent) {
        throw new Exception("'${idPart}' の詳細データ (${url}) を取得できませんでした。", 500);
    }
    return $xmlContent;
}

/**
 * \nエスケープシーケンスを実際の改行に変換する
 */
function processLineBreaks(string $text): string
{
    // \nを実際の改行文字に変換
    $text = str_replace('\\n', "\n", $text);
    // 複数の連続する改行を整理（オプション）
    $text = preg_replace('/\n{3,}/', "\n\n", $text);
    return trim($text);
}

/**
 * 土砂災害警戒情報のXMLコンテンツを解析し、構造化された配列に変換します。
 */
function parseLandslideInfoXml(string $xmlContent): array
{
    // ===【最重要】名前空間を除去してXMLを無力化・単純化する ===
    $xmlContent = preg_replace('/\\sxmlns(="[^"]+"*|:[^=]+="[^"]+")/', '', $xmlContent);
    $xmlContent = preg_replace('/<([a-zA-Z0-9]+):([a-zA-Z0-9]+)/', '<$2', $xmlContent);
    $xmlContent = preg_replace('/<\\/([a-zA-Z0-9]+):([a-zA-Z0-9]+)/', '</$2', $xmlContent);
    $xmlContent = preg_replace('/(xsi:type=)"[^"]+"/', '', $xmlContent); // xsi:type属性も除去

    $xml = @simplexml_load_string($xmlContent);
    if ($xml === false) {
        throw new Exception('名前空間除去後のXML解析に失敗しました。', 500);
    }

    $result = [];

    // Controlセクションの解析 (単純なプロパティアクセスでOK)
    if (isset($xml->Control)) {
        $control = $xml->Control;
        $result['control'] = [
            'title' => processLineBreaks((string)($control->Title ?? '')),
            'publishingOffice' => processLineBreaks((string)($control->PublishingOffice ?? '')),
            'xmlDateTime' => (string)($control->DateTime ?? ''),
        ];
    }

    // Headセクションの解析
    if (isset($xml->Head)) {
        $head = $xml->Head;
        $result['head'] = [
            'title' => processLineBreaks((string)($head->Title ?? '')),
            'reportDateTime' => (string)($head->ReportDateTime ?? ''),
            'infoType' => processLineBreaks((string)($head->InfoType ?? '')),
            'headlineText' => processLineBreaks((string)($head->Headline->Text ?? '')),
            'alertSummary' => [],
        ];

        if (isset($head->Headline->Information->Item)) {
            foreach ($head->Headline->Information->Item as $item) {
                $areasData = [];
                if (isset($item->Areas->Area)) {
                    foreach ($item->Areas->Area as $area) {
                        $areasData[] = [
                            'name' => processLineBreaks((string)($area->Name ?? '')),
                            'code' => (string)($area->Code ?? ''),
                        ];
                    }
                }
                $result['head']['alertSummary'][] = [
                    'condition' => processLineBreaks((string)($item->Kind->Condition ?? '')),
                    'areas' => $areasData,
                ];
            }
        }
    }

    // Bodyセクションの解析
    if (isset($xml->Body)) {
        $body = $xml->Body;
        $result['body'] = [
            'targetPrefectures' => [],
            'warnings' => [],
            'contactInfo' => [],
        ];

        if (isset($body->TargetArea)) {
            // 複数の<TargetArea>があっても、1つだけでもforeachで回せる
            foreach ($body->TargetArea as $targetArea) {
                $result['body']['targetPrefectures'][] = [
                    'name' => processLineBreaks((string)($targetArea->Name ?? '')),
                    'code' => (string)($targetArea->Code ?? ''),
                ];
            }
        }

        if (isset($body->Warning->Item)) {
            foreach ($body->Warning->Item as $item) {
                $alertLevelData = [
                    'name'   => processLineBreaks((string)($item->Kind->Name ?? '')),
                    'code'   => (string)($item->Kind->Code ?? ''),
                    'status' => processLineBreaks((string)($item->Kind->Status ?? '')),
                ];

                // 複数形<Areas>と単数形<Area>の両方に対応
                $areaEntries = $item->Areas->Area ?? ($item->Area ?? []);

                // 1つしかない場合もループで処理できるように配列に変換
                if (!is_array($areaEntries) && is_object($areaEntries)) {
                    $areaEntries = [$areaEntries];
                }

                foreach ($areaEntries as $area) {
                     if (isset($area->Name)) { // 空のオブジェクトを避ける
                        $result['body']['warnings'][] = [
                            'area' => [
                                'name' => processLineBreaks((string)($area->Name ?? '')),
                                'code' => (string)($area->Code ?? ''),
                            ],
                            'alertLevel' => $alertLevelData,
                        ];
                    }
                }
            }
        }

        if (isset($body->OfficeInfo->Office)) {
            foreach($body->OfficeInfo->Office as $office) {
                $type = (string)($office['type'] ?? '');
                $key = ($type === '都道府県') ? 'prefecture' : 'jma';
                if ($key) {
                    $result['body']['contactInfo'][$key] = [
                        'name' => processLineBreaks((string)($office->Name ?? '')),
                        'phone' => processLineBreaks((string)($office->ContactInfo ?? '')),
                    ];
                }
            }
        }
    }

    return $result;
}

/**
 * 配列をJSONに変換し、HTTPヘッダーを付けて出力します。
 */
function sendJsonResponse(array $data, int $statusCode = 200): void
{
    header('Content-Type: application/json; charset=utf-8');
    http_response_code($statusCode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit();
}
?>