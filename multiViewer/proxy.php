<?php
if (!isset($_GET['url'])) {
    http_response_code(400);
    exit;
}

$url = $_GET['url'];

$is_m3u8 = preg_match('/\.m3u8(\?|$)/', $url);

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_HEADER, true);

$headers = [];
if (isset($_SERVER['HTTP_RANGE'])) {
    $headers[] = 'Range: ' . $_SERVER['HTTP_RANGE'];
}
if ($headers) curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);

$response = curl_exec($ch);
$header_size = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
$body = substr($response, $header_size);
$header_text = substr($response, 0, $header_size);
$contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

/* ===== CORS ===== */
header("Access-Control-Allow-Origin: https://tool.ikunocam.net");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Origin, Range, Accept");
header("Access-Control-Expose-Headers: Content-Length, Content-Range");

/* ===== ヘッダ転送 ===== */
foreach (explode("\r\n", $header_text) as $h) {
    if (
        stripos($h, 'Content-Type:') === 0 ||
        stripos($h, 'Content-Range:') === 0 ||
        stripos($h, 'Accept-Ranges:') === 0
    ) {
        header($h);
    }
}

if ($is_m3u8) {
    header("Content-Type: application/vnd.apple.mpegurl");

    $base = dirname($url);
    $lines = explode("\n", $body);
    foreach ($lines as &$l) {
        $l = trim($l);
        if ($l === '' || $l[0] === '#') continue;
        if (strpos($l, 'http') !== 0) {
            $l = 'proxy.php?url=' . urlencode($base . '/' . $l);
        } else {
            $l = 'proxy.php?url=' . urlencode($l);
        }
    }
    echo implode("\n", $lines);
} else {
    echo $body;
}
