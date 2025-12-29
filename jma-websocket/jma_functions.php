<?php
// jma_functions.php

/**
 * 気象庁のフィードを読み込み、目的のデータURLを取得します。
 */
function fetchLatestDataUrl(string $feedUrl, string $idPart): string
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
    if (isset($entries[0]['href'])) {
        return (string)$entries[0]['href'];
    }
    throw new Exception("フィード内に '${idPart}' のURLが見つかりませんでした。", 404);
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
 * 土砂災害警戒情報のXMLコンテンツを解析し、構造化された配列に変換します。
 */
function parseLandslideInfoXml(string $xmlContent): array
{
    $xmlContent = preg_replace('/\\sxmlns(="[^"]+"*|:[^=]+="[^"]+")/', '', $xmlContent);
    $xmlContent = preg_replace('/<([a-zA-Z0-9]+):([a-zA-Z0-9]+)/', '<$2', $xmlContent);
    $xmlContent = preg_replace('/<\\/([a-zA-Z0-9]+):([a-zA-Z0-9]+)/', '</$2', $xmlContent);
    $xmlContent = preg_replace('/(xsi:type=)"[^"]+"/', '', $xmlContent);
    $xml = @simplexml_load_string($xmlContent);
    if ($xml === false) {
        throw new Exception('名前空間除去後のXML解析に失敗しました。', 500);
    }
    $result = [];
    if (isset($xml->Control)) {
        $control = $xml->Control;
        $result['control'] = [
            'title' => (string)($control->Title ?? ''),
            'publishingOffice' => (string)($control->PublishingOffice ?? ''),
            'xmlDateTime' => (string)($control->DateTime ?? ''),
        ];
    }
    if (isset($xml->Head)) {
        $head = $xml->Head;
        $result['head'] = [
            'title' => (string)($head->Title ?? ''),
            'reportDateTime' => (string)($head->ReportDateTime ?? ''),
            'infoType' => (string)($head->InfoType ?? ''),
            'headlineText' => trim((string)($head->Headline->Text ?? '')),
            'alertSummary' => [],
        ];
        if (isset($head->Headline->Information->Item)) {
            foreach ($head->Headline->Information->Item as $item) {
                $areasData = [];
                if (isset($item->Areas->Area)) {
                    foreach ($item->Areas->Area as $area) {
                        $areasData[] = [
                            'name' => (string)($area->Name ?? ''),
                            'code' => (string)($area->Code ?? ''),
                        ];
                    }
                }
                $result['head']['alertSummary'][] = [
                    'condition' => (string)($item->Kind->Condition ?? ''),
                    'areas' => $areasData,
                ];
            }
        }
    }
    if (isset($xml->Body)) {
        $body = $xml->Body;
        $result['body'] = [
            'targetPrefecture' => [
                'name' => (string)($body->TargetArea->Name ?? ''),
                'code' => (string)($body->TargetArea->Code ?? ''),
            ],
            'warnings' => [],
            'contactInfo' => [],
        ];
        if (isset($body->Warning->Item)) {
            foreach ($body->Warning->Item as $item) {
                $alertLevelData = [
                    'name'   => (string)($item->Kind->Name ?? ''),
                    'code'   => (string)($item->Kind->Code ?? ''),
                    'status' => (string)($item->Kind->Status ?? ''),
                ];
                $areaEntries = $item->Areas->Area ?? ($item->Area ?? []);
                if (!is_array($areaEntries)) {
                    $areaEntries = [$areaEntries];
                }
                foreach ($areaEntries as $area) {
                     if (isset($area->Name)) {
                        $result['body']['warnings'][] = [
                            'area' => [
                                'name' => (string)($area->Name ?? ''),
                                'code' => (string)($area->Code ?? ''),
                            ],
                            'alertLevel' => $alertLevelData,
                        ];
                    }
                }
            }
        }
    }
    return $result;
}