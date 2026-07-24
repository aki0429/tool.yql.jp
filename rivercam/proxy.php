<?php
// リクエスト元のカメラIDを取得
$cam_id = isset($_GET['cam_id']) ? $_GET['cam_id'] : null;
$url_param = isset($_GET['url']) ? $_GET['url'] : null;

// カメラIDまたはURLが指定されていない場合はエラー
if (!$cam_id && !$url_param) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Invalid or missing camera ID or URL.']);
    exit;
}

// URLを構築
if ($url_param) {
    $url = $url_param;
} else {
    // カメラIDが指定されている場合
    if (!ctype_digit($cam_id)) {
        http_response_code(400);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Invalid camera ID.']);
        exit;
    }
    $url = 'https://www.river.go.jp/kawabou/file/files/master/obs/scam/' . $cam_id . '.json';
}

// file_get_contentsで外部URLからデータを取得
$json_data = @file_get_contents($url);

// データの取得に失敗した場合
if ($json_data === false) {
    http_response_code(502);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Failed to fetch data from the external server.']);
    exit;
}

// 取得したデータがJSON形式であることをブラウザに伝えるヘッダーを送信
header('Content-Type: application/json; charset=utf-8');

// 取得したJSONデータをそのまま出力
echo $json_data;

?>