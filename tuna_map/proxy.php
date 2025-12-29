<?php
// proxy.php

// -------------------------------------------------------
// エラー詳細を表示させる（デバッグ用: 解決したら 0 にしてください）
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);
// -------------------------------------------------------

// 1. URLパラメータの取得
$target_url = isset($_GET['url']) ? $_GET['url'] : '';

// 2. セキュリティチェック (気象庁ドメイン以外は弾く)
if (strpos($target_url, 'https://www.jma.go.jp/') !== 0) {
    http_response_code(400);
    header('Content-Type: application/json');
    echo json_encode(['error' => 'Invalid URL. Only jma.go.jp is allowed.']);
    exit;
}

// 3. cURLを使ってデータを取得 (file_get_contentsより強力)
$ch = curl_init();

// オプション設定
curl_setopt($ch, CURLOPT_URL, $target_url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

// 重要: 500エラー回避策 (SSL証明書検証を無視する)
// ※ローカル環境では証明書エラーで落ちることが多いため
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);

// 重要: ブラウザのふりをする (User-Agentがないと弾かれる場合がある)
curl_setopt($ch, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

// 実行
$content = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_error = curl_error($ch);

curl_close($ch);

// 4. エラーハンドリング
if ($content === false || $http_code !== 200) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'error' => 'Failed to fetch data.',
        'http_code' => $http_code,
        'curl_error' => $curl_error,
        'target' => $target_url
    ]);
    exit;
}

// 5. 正常レスポンス
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");
echo $content;
?>