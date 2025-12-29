<?php
// リクエスト元のカメラIDを取得
$cam_id = isset($_GET['cam_id']) ? $_GET['cam_id'] : null;

// カメラIDが指定されていない、または数字でない場合はエラー
if (!$cam_id || !ctype_digit($cam_id)) {
    // HTTPステータス400 Bad Requestを返す
    http_response_code(400);
    // エラーメッセージをJSON形式で返す
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Invalid or missing camera ID.']);
    exit;
}

// 取得対象のURLを構築
$url = 'https://www.river.go.jp/kawabou/file/files/master/obs/scam/' . $cam_id . '.json';

// file_get_contentsで外部URLからデータを取得
// エラー抑制演算子@を使用して、取得失敗時にWarningが出ないようにする
$json_data = @file_get_contents($url);

// データの取得に失敗した場合
if ($json_data === false) {
    // HTTPステータス502 Bad Gatewayなどを返す
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