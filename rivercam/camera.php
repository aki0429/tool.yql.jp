<?php
$date = $_GET['url'];
$url = "https://www.river.go.jp/kawabou/file/files/master/obs/scam/".$date.".json";
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_HEADER, false);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 60);
$json = curl_exec($ch);
curl_close($ch);
$json = mb_convert_encoding($json, 'UTF8', 'ASCII,JIS,UTF-8,EUC-JP,SJIS-WIN');
//$arr = json_decode($json,true);
echo $json;
?>