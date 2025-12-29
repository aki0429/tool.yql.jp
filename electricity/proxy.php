<?php
header("Access-Control-Allow-Origin: *"); // CORSを許可
header("Content-Type: application/json"); // JSON形式で返す

if (!isset($_GET['url'])) {
    echo json_encode(["error" => "URL is required"]);
    exit;
}

$url = $_GET['url'];

// URLの検証（必要に応じて）
if (!filter_var($url, FILTER_VALIDATE_URL)) {
    echo json_encode(["error" => "Invalid URL"]);
    exit;
}

// データを取得
$response = file_get_contents($url);
if ($response === FALSE) {
    echo json_encode(["error" => "Unable to fetch data"]);
    exit;
}

// データを返す
echo $response;
?>