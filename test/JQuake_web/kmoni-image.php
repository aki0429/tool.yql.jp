<?php
declare(strict_types=1);

// 実行時間の制限を5秒に設定
set_time_limit(5);

$allowedTypes = ['jma_s', 'acmap_s', 'vcmap_s', 'jma_b', 'acmap_b', 'vcmap_b', 'abrspmx_s'];
$type = isset($_GET['type']) ? (string) $_GET['type'] : 'jma_s';

if (!in_array($type, $allowedTypes, true)) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Invalid image type'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Method not allowed'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if (isset($_GET['ping'])) {
    http_response_code(204);
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    exit;
}

// システム時計ではなく、NICTのAPIから正確な日本標準時を取得
$exactUnixTime = getExactUnixTime();

// 正確な現在時刻から -2秒 のタイムスタンプを生成
$timestamp = (new DateTimeImmutable('@' . (int)$exactUnixTime))
    ->setTimezone(new DateTimeZone('Asia/Tokyo'))
    ->modify('-2 seconds')
    ->format('YmdHis');

// リトライ処理を含む画像取得関数を呼び出し
$response = fetchLatestAvailableImage($type, $timestamp);

if ($response['body'] === false || $response['status'] < 200 || $response['status'] >= 300) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    
    $debugUrl = buildImageUrl($type, $timestamp);
    
    echo json_encode([
        'error' => 'Failed to fetch KMoni image.',
        'status' => $response['status'],
        'detail' => $response['error'],
        'type' => $type,
        'tried_url' => $debugUrl,
        'attempts' => $response['attempts'] ?? 0,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

header('Content-Type: image/gif');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('X-Kmoni-Time: ' . ($response['timestamp'] ?? 'unknown'));
header('X-Fetch-Attempts: ' . ($response['attempts'] ?? 1)); // 何回目で取得できたかヘッダーに出力（デバッグ用）
echo $response['body'];


/**
 * 画像のURLを構築する
 */
function buildImageUrl(string $type, string $timestamp): string
{
    $isAbrspmx = $type === 'abrspmx_s';
    $domain = $isAbrspmx ? 'www.lmoni.bosai.go.jp' : 'www.kmoni.bosai.go.jp';
    $path = $isAbrspmx ? 'monitor/data/data/map_img/RealTimeImg' : 'data/map_img/RealTimeImg';
    $protocol = $isAbrspmx ? 'https' : 'http';
    
    return sprintf(
        '%s://%s/%s/%s/%s/%s.%s.gif',
        $protocol,
        $domain,
        $path,
        $type,
        substr($timestamp, 0, 8),
        $timestamp,
        $type
    );
}

/**
 * リトライロジックを含めて最新の画像を取得する
 */
function fetchLatestAvailableImage(string $type, string $timestamp): array
{
    $maxAttempts = 5;            // 最大5回試行（合計で約1秒待機）
    $sleepMicroseconds = 200000; // 200,000マイクロ秒 = 0.2秒間隔でリトライ
    
    $response = null;

    for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
        $response = fetchUrl(buildImageUrl($type, $timestamp), 'image/gif');
        
        // 取得成功時は即座に結果を返す
        if ($response['body'] !== false && $response['status'] >= 200 && $response['status'] < 300) {
            return [
                'body' => $response['body'],
                'status' => $response['status'],
                'error' => $response['error'],
                'timestamp' => $timestamp,
                'attempts' => $attempt,
            ];
        }

        // 失敗時、最後の試行でなければ待機する
        if ($attempt < $maxAttempts) {
            usleep($sleepMicroseconds);
        }
    }

    return [
        'body' => false,
        'status' => $response['status'] ?: 502,
        'error' => $response['error'] ?: "Image not found after {$maxAttempts} attempts",
        'timestamp' => $timestamp,
        'attempts' => $maxAttempts,
    ];
}

/**
 * URLからデータを取得する（cURLまたはfile_get_contents）
 */
function fetchUrl(string $url, string $accept): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 1,
            CURLOPT_TIMEOUT => 2, // タイムアウトを少し短縮してループの詰まりを防止
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            CURLOPT_HTTPHEADER => ['Accept: ' . $accept],
        ]);

        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        return [
            'body' => $body,
            'status' => $status,
            'error' => $error,
        ];
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 2,
            'header' => "Accept: {$accept}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\n",
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
        ],
    ]);
    
    $body = @file_get_contents($url, false, $context);
    $status = 0;

    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $matches)) {
        $status = (int) $matches[1];
    }

    return [
        'body' => $body,
        'status' => $status,
        'error' => '',
    ];
}

/**
 * NICTから正確な日本標準時（UNIXタイムスタンプ）を取得する
 */
function getExactUnixTime(): float
{
    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 1.0, // 時刻取得でつまずかないよう1秒でタイムアウト
            'header' => "User-Agent: KmoniScript/1.0\r\n",
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false,
        ],
    ]);
    
    // NICTのHTTPS APIからJSONで時刻を取得
    $json = @file_get_contents('https://ntp-a1.nict.go.jp/cgi-bin/json', false, $context);
    
    if ($json && $data = json_decode($json, true)) {
        if (isset($data['st'])) {
            return (float) $data['st'];
        }
    }
    
    // APIが利用できない場合はシステム時計にフォールバック
    return microtime(true);
}