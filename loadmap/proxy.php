<?php
/**
 * proxy.php
 * 
 * 外部JSONや画像をCORS制限なしで取得するプロキシ
 * @version 2025-11-13
 */

// 1️⃣ URLパラメータが無ければ終了
if (!isset($_GET['url'])) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Missing URL parameter']);
    exit;
}

// 2️⃣ URLデコード
$url = urldecode($_GET['url']);

// 3️⃣ セキュリティ: 許可するドメインのみ
$allowed_domains = [
    'www.road-info-prvs.mlit.go.jp',
];
$parsed = parse_url($url);
if (!isset($parsed['host']) || !in_array($parsed['host'], $allowed_domains)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Domain not allowed']);
    exit;
}

// 4️⃣ CORS許可（ローカルJSからアクセスできるように）
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    exit; // preflight用
}

// 5️⃣ リモートから取得
$context = stream_context_create([
    'http' => [
        'method' => 'GET',
        'header' => "User-Agent: Mozilla/5.0\r\n",
        'timeout' => 10
    ],
    'ssl' => [
        'verify_peer' => true,
        'verify_peer_name' => true,
    ]
]);

$data = @file_get_contents($url, false, $context);

// 6️⃣ エラー処理
if ($data === false) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Failed to fetch remote resource', 'url' => $url]);
    exit;
}

// 7️⃣ コンテンツタイプを自動で推定
$finfo = new finfo(FILEINFO_MIME_TYPE);
$type = $finfo->buffer($data);
if (strpos($type, 'json') !== false) {
    header('Content-Type: application/json; charset=utf-8');
} elseif (strpos($type, 'image') !== false) {
    header('Content-Type: image/jpeg');
} else {
    header('Content-Type: text/plain; charset=utf-8');
}

// 8️⃣ 出力
echo $data;
?>
