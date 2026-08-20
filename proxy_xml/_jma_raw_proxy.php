<?php
/**
 * 気象庁防災XMLの最新電文を、内容を一切変更せずに中継する共通処理。
 * 各公開エンドポイントから jmaRawProxy() を呼び出して使用する。
 */

declare(strict_types=1);

function jmaFetch(string $url): array
{
    $headers = [];
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_USERAGENT => 'tool.yql.jp JMA XML proxy',
        CURLOPT_HEADERFUNCTION => static function ($ch, string $line) use (&$headers): int {
            $length = strlen($line);
            $separator = strpos($line, ':');
            if ($separator !== false) {
                $name = strtolower(trim(substr($line, 0, $separator)));
                $headers[$name] = trim(substr($line, $separator + 1));
            }
            return $length;
        },
    ]);

    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $error = curl_error($ch);
    curl_close($ch);

    if ($body === false || $status < 200 || $status >= 300) {
        throw new RuntimeException($error !== '' ? $error : "Upstream returned HTTP {$status}");
    }

    return [$body, $headers];
}

function jmaRawProxy(string $feedName, string $productCode): void
{
    header('Access-Control-Allow-Origin: *');
    header('X-Content-Type-Options: nosniff');

    try {
        [$feedBody] = jmaFetch("https://www.data.jma.go.jp/developer/xml/feed/{$feedName}.xml");

        $document = new DOMDocument();
        if (!@$document->loadXML($feedBody, LIBXML_NONET)) {
            throw new RuntimeException('Failed to parse the JMA feed');
        }

        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('atom', 'http://www.w3.org/2005/Atom');
        $links = $xpath->query('//atom:entry/atom:link[@href]');
        $detailUrl = null;

        foreach ($links as $link) {
            $href = $link->getAttribute('href');
            if (strpos($href, $productCode) !== false) {
                $detailUrl = $href;
                break;
            }
        }

        if ($detailUrl === null) {
            // 現在フィードに対象電文がない場合はエラーにせず、JSONのnullを返す。
            http_response_code(200);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-cache');
            echo 'null';
            return;
        }

        [$xmlBody, $upstreamHeaders] = jmaFetch($detailUrl);

        foreach (['content-type', 'last-modified', 'etag', 'cache-control', 'expires'] as $name) {
            if (isset($upstreamHeaders[$name])) {
                header($name . ': ' . $upstreamHeaders[$name]);
            }
        }
        if (!isset($upstreamHeaders['content-type'])) {
            header('Content-Type: application/xml');
        }
        header('X-Proxy-Source: ' . $detailUrl);

        // XMLの文字・改行・名前空間を変換せず、取得したバイト列をそのまま返す。
        echo $xmlBody;
    } catch (Throwable $error) {
        http_response_code(502);
        header('Content-Type: text/plain; charset=utf-8');
        echo 'Failed to fetch the JMA XML.';
    }
}
