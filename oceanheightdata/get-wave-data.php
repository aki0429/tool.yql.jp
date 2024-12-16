<?php
// CORSヘッダーの設定
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Content-Type');

// エラーハンドリングの設定
set_error_handler(function($severity, $message, $file, $line) {
    throw new ErrorException($message, 0, $severity, $file, $line);
});

try {
    $url = 'https://nowphas.mlit.go.jp/PROG/xml/POINT_SETUP.xml';
    
    // コンテキストオプションの設定
    $opts = [
        'http' => [
            'method' => 'GET',
            'header' => [
                'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept: application/xml',
                'Cache-Control: no-cache'
            ],
            'timeout' => 30,
            'ignore_errors' => true
        ],
        'ssl' => [
            'verify_peer' => false,
            'verify_peer_name' => false
        ]
    ];
    
    $context = stream_context_create($opts);
    
    // XMLデータの取得
    $response = file_get_contents($url, false, $context);
    
    if ($response === false) {
        throw new Exception('Failed to fetch data from the server');
    }
    
    // XMLの解析
    $xml = simplexml_load_string($response);
    if ($xml === false) {
        throw new Exception('Failed to parse XML data');
    }
    
    $points = [];
    foreach ($xml->Point as $point) {
        if (isset($point['WaveHeight']) && isset($point['Lat']) && isset($point['Lon'])) {
            $points[] = [
                'lat' => (float)$point['Lat'],
                'lon' => (float)$point['Lon'],
                'name' => (string)$point['Name'],
                'waveHeight' => (float)$point['WaveHeight']
            ];
        }
    }
    
    echo json_encode([
        'status' => 'success',
        'data' => $points,
        'timestamp' => time()
    ]);

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => $e->getMessage(),
        'timestamp' => time()
    ]);
}
?>
