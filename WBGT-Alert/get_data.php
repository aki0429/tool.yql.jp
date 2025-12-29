<?php
// ★最初にヘッダーは送らず、最後にまとめて送信する
// ===== デバッグ用コード =====
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);
// ==========================


// (ここに元々のあなたのPHPコードが続く)
// header('Content-Type: application/json');
// ...
// データソースのURL
$url = 'https://www.wbgt.env.go.jp/prev/wbgt_data.json';

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
// CURLOPT_FAILONERROR は使わず、手動でステータスコードをチェックする
// curl_setopt($ch, CURLOPT_FAILONERROR, true);

$responseBody = curl_exec($ch);
$httpStatusCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

// デフォルトのヘッダーを設定
header('Content-Type: application/json; charset=utf-8');

// 1. cURL自体にエラーがあったかチェック
if ($curlError) {
    http_response_code(500); // Internal Server Error
    echo json_encode(['error' => 'Failed to connect to the data source.', 'details' => $curlError]);
    exit;
}

// 2. 相手サーバーのHTTPステータスコードをチェック (200番台以外はエラー)
if ($httpStatusCode < 200 || $httpStatusCode >= 300) {
    http_response_code(502); // Bad Gateway
    echo json_encode(['error' => 'The data source returned an error.', 'status_code' => $httpStatusCode]);
    exit;
}

// 3. 取得したデータがJSONとして有効かチェック
json_decode($responseBody);
if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(500); // Internal Server Error
    echo json_encode(['error' => 'The data source returned invalid JSON.', 'details' => json_last_error_msg()]);
    exit;
}

// 全てのチェックを通過したら、取得したJSONデータをそのまま出力
echo $responseBody;