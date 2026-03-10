<?php
ob_start();
error_reporting(0);
ini_set('display_errors', 0);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');

if (!isset($_GET['station'])) {
    http_response_code(400);
    ob_clean();
    echo json_encode(['error' => 'station parameter required']);
    exit;
}

$station = preg_replace('/[^a-z]/', '', strtolower($_GET['station']));
$type = isset($_GET['type']) ? $_GET['type'] : 'rest';

// ──── URL決定 ────
switch ($type) {
    case 'kyushi':
        $url = "https://www.nhk.or.jp/{$station}/station_info/kyushi.html";
        break;
    case 'kyuushi':
        $url = "https://www.nhk.or.jp/{$station}/station_info/kyuushi.html";
        break;
    case 'pdf':
        // PDFは取得不可、リンクを返す
        $pdfUrl = isset($_GET['pdf']) ? $_GET['pdf'] : "https://www.nhk.or.jp/{$station}/station_info/kyushi_pdf/list.pdf";
        ob_clean();
        echo json_encode([
            'station' => $station,
            'rows'    => [],
            'count'   => 0,
            'pdf'     => $pdfUrl,
        ], JSON_UNESCAPED_UNICODE);
        exit;
    case 'info':
        // station_info/ ページから放送休止記事のリンクを探す
        $url = findInfoArticleUrl($station);
        if (!$url) {
            ob_clean();
            echo json_encode(['error' => 'article_not_found', 'station' => $station]);
            exit;
        }
        break;
    default: // rest
        $url = "https://www.nhk.or.jp/{$station}/station_info/rest.html";
        break;
}

// ──── HTML取得 ────
$html = fetchUrl($url);
if ($html === false) {
    ob_clean();
    echo json_encode(['error' => 'fetch_failed', 'station' => $station, 'url' => $url]);
    exit;
}

// ──── パース ────
$rows = parseTable($html);

// テーブルが無い場合、テキスト形式（北海道方式）を試す
if (empty($rows)) {
    $rows = parseTextFormat($html);
}

ob_clean();
echo json_encode([
    'station'    => $station,
    'rows'       => $rows,
    'count'      => count($rows),
    'sourceUrl'  => $url,
], JSON_UNESCAPED_UNICODE);

// ════════════════════════════════════════
// 関数定義
// ════════════════════════════════════════

function loadDom($html) {
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    $dom->loadHTML('<?xml encoding="UTF-8">' . $html);
    libxml_clear_errors();
    return $dom;
}

function fetchUrl($url) {
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
    curl_setopt($ch, CURLOPT_TIMEOUT, 15);
    curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    $html = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode !== 200 || $html === false) {
        return false;
    }
    return $html;
}

/**
 * station_info/ ページから放送休止記事のリンクを探して返す
 */
function findInfoArticleUrl($station) {
    $indexUrl = "https://www.nhk.or.jp/{$station}/station_info/";
    $html = fetchUrl($indexUrl);
    if (!$html) return false;

    $dom = loadDom($html);
    $xpath = new DOMXPath($dom);

    $links = $xpath->query('//a');
    foreach ($links as $link) {
        $text = trim($link->textContent);
        $href = $link->getAttribute('href');
        if (preg_match('/放送休止/', $text) && preg_match('/articles|info/', $href)) {
            // 相対URLを絶対URLに変換
            if (strpos($href, 'http') !== 0) {
                $href = "https://www.nhk.or.jp" . $href;
            }
            return $href;
        }
    }
    return false;
}

/**
 * テーブル形式のパース (大多数の局)
 */
function parseTable($html) {
    $dom = loadDom($html);
    $xpath = new DOMXPath($dom);

    $rows = [];
    $tables = $xpath->query('//table');

    foreach ($tables as $table) {
        $trs = $xpath->query('.//tr', $table);
        foreach ($trs as $tr) {
            $tds = $xpath->query('.//td|.//th', $tr);
            $cells = [];
            foreach ($tds as $td) {
                $text = trim($td->textContent);
                if ($text !== '' && $text !== '地域' && $text !== '日付' && $text !== '時間' && $text !== 'テレビ・ラジオ') {
                    $cells[] = $text;
                }
            }
            if (count($cells) >= 4) {
                $rows[] = [
                    'area'    => $cells[0],
                    'date'    => $cells[1],
                    'time'    => $cells[2],
                    'channel' => $cells[3],
                ];
            }
        }
    }
    return $rows;
}

/**
 * テキスト形式のパース (北海道方式: h2見出し = 放送波、テキストノード = 各エントリ)
 * 例: "3月2日（月）午前0：56～4：00＜1日（日）深夜＞函館、帯広、釧路"
 */
function parseTextFormat($html) {
    $dom = loadDom($html);
    $xpath = new DOMXPath($dom);

    $rows = [];
    $currentChannel = '';

    // 全 h2/h3/p/li を文書順で取得
    $nodes = $xpath->query('//*[self::h2 or self::h3 or self::p or self::li]');
    if (!$nodes) return [];

    $inSection = false;

    foreach ($nodes as $node) {
        $text = trim($node->textContent);
        $tag  = strtolower($node->nodeName);

        if ($tag === 'h2' || $tag === 'h3') {
            if (preg_match('/^(総合|ラジオ第[1１]|ラジオ第[2２]|ＦＭ|FM|Eテレ|R1|R2)/u', $text, $m)) {
                $currentChannel = $m[1];
                $inSection = true;
            } else {
                $inSection = false;
            }
            continue;
        }

        if (!$inSection || !$currentChannel || $text === '') continue;

        // "3月2日（月）午前0：56～4：00＜1日（日）深夜＞函館、帯広、釧路"
        // 全角記号も考慮して u フラグ付きでマッチ
        if (preg_match('/(\d+月\d+日[（(][^)）]*[)）])\s*(.+?[～〜].+?)\s*[＜<](.+?)[＞>]\s*(.+)/u', $text, $m)) {
            $rows[] = [
                'area'    => trim($m[4]),
                'date'    => trim($m[1]) . ' ※' . trim($m[3]),
                'time'    => trim($m[2]),
                'channel' => $currentChannel,
            ];
        }
    }
    return $rows;
}
