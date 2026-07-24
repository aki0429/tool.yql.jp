<?php
header("Access-Control-Allow-Origin: *");
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");

$company = $_GET["company"] ?? "";

if ($company === "") {
    http_response_code(400);
    header("Content-Type: text/plain; charset=UTF-8");
    echo "company is required";
    exit;
}

$today = new DateTime("now", new DateTimeZone("Asia/Tokyo"));
$ymd = $today->format("Ymd");
$year = $today->format("Y");

$sources = [
    "hokkaido" => "https://denkiyoho.hepco.co.jp/area/data/juyo_01_{$ymd}.csv",
    "tohoku" => "https://setsuden.nw.tohoku-epco.co.jp/common/demand/realtime_jukyu/realtime_jukyu_{$ymd}_02.csv",
    "tokyo" => "https://www.tepco.co.jp/forecast/html/images/juyo-s1-j.csv",
    "chubu" => "https://powergrid.chuden.co.jp/denki_yoho_content_data/areajuyo_current.csv",
    "hokuriku" => "https://www.rikuden.co.jp/nw/denki-yoho/csv/juyo_05_{$ymd}.csv",
    "kansai" => "https://www.kansai-td.co.jp/yamasou/juyo_06_{$ymd}.csv",
    "chugoku" => "https://www.energia.co.jp/nw/jukyuu/sys/juyo_07_{$ymd}.csv",
    "shikoku" => "https://www.yonden.co.jp/nw/denkiyoho/juyo_08_{$ymd}.csv",
    "kyushu" => "https://www.kyuden.co.jp/td_power_usages/csv/juyo-hourly-{$ymd}.csv",
    "okinawa" => "https://www.okiden.co.jp/denki2/juyo_10_{$ymd}.csv",
];

if (!isset($sources[$company])) {
    http_response_code(404);
    header("Content-Type: text/plain; charset=UTF-8");
    echo "unknown company";
    exit;
}

$url = $sources[$company];

function fetch_with_curl($url) {
    if (!function_exists("curl_init")) {
        return false;
    }

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_USERAGENT => "Mozilla/5.0",
        CURLOPT_FAILONERROR => false,
    ]);

    $body = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $contentType = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    curl_close($ch);

    if ($body === false || $status < 200 || $status >= 300) {
        return false;
    }

    return ["body" => $body, "content_type" => $contentType ?: "text/plain; charset=Shift_JIS"];
}

function fetch_with_stream($url) {
    $context = stream_context_create([
        "http" => [
            "method" => "GET",
            "timeout" => 12,
            "ignore_errors" => true,
            "header" => "User-Agent: Mozilla/5.0\r\n",
        ],
    ]);

    $body = @file_get_contents($url, false, $context);

    if ($body === false || $body === "") {
        return false;
    }

    return ["body" => $body, "content_type" => "text/plain; charset=Shift_JIS"];
}

$result = fetch_with_curl($url);

if ($result === false) {
    $result = fetch_with_stream($url);
}

if ($result === false) {
    http_response_code(502);
    header("Content-Type: text/plain; charset=UTF-8");
    echo "Unable to fetch source CSV";
    exit;
}

header("X-Company-Id: " . $company);
header("X-Source-Url: " . $url);
header("Content-Type: " . $result["content_type"]);
echo $result["body"];
