<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$seedUrl = isset($_GET['seed_url']) ? (string) $_GET['seed_url'] : '';
$seed = parseSeed($seedUrl);

if ($seed === null) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid seed_url'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if ($seed['itmkndCd'] !== '1') {
    http_response_code(400);
    echo json_encode([
        'error' => 'Unsupported itmkndCd',
        'message' => 'river.go.jp itmkndCd=1 is MLIT rain observation, not JMA AMeDAS.',
        'seed' => $seed,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$obsFcd = buildObsFcd($seed);
$masterUrl = "https://www.river.go.jp/kawabou/file/files/master/obs/rn/{$obsFcd}.json";
$masterResponse = fetchJsonUrl($masterUrl);

if ($masterResponse['data'] === null) {
    http_response_code(502);
    echo json_encode([
        'error' => 'Unable to fetch station master JSON',
        'station_master_url' => $masterUrl,
        'seed' => $seed,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

$valueAttempt = fetchLatestRainValues($obsFcd);
$observation = normalizeObservation($seed, $obsFcd, $masterResponse['data'], $valueAttempt['data']);

echo json_encode([
    'type' => 'FeatureCollection',
    'provider' => 'MLIT',
    'provider_label' => 'MLIT River Rain Gauge',
    'station_type' => 'MLIT rain observation (not JMA AMeDAS)',
    'seed' => $seed,
    'obsFcd' => $obsFcd,
    'source_urls' => [
        'station_master' => $masterUrl,
        'latest_values' => $valueAttempt['source_url'],
    ],
    'attempted_value_urls' => $valueAttempt['attempted_urls'],
    'features' => [$observation],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

function parseSeed(string $seedUrl): ?array
{
    $parts = parse_url($seedUrl);
    if (!$parts || !isset($parts['host']) || !preg_match('/(^|\.)river\.go\.jp$/', $parts['host'])) {
        return null;
    }

    $query = [];
    parse_str($parts['query'] ?? '', $query);

    $ofcCd = digits((string)($query['ofcCd'] ?? ''));
    $itmkndCd = digits((string)($query['itmkndCd'] ?? ''));
    $obsCd = digits((string)($query['obsCd'] ?? ''));

    if ($ofcCd === '' || $itmkndCd === '' || $obsCd === '') {
        return null;
    }

    return [
        'url' => $seedUrl,
        'ofcCd' => $ofcCd,
        'itmkndCd' => $itmkndCd,
        'obsCd' => $obsCd,
        'lat' => isset($query['clat']) && is_numeric($query['clat']) ? (float)$query['clat'] : null,
        'lon' => isset($query['clon']) && is_numeric($query['clon']) ? (float)$query['clon'] : null,
    ];
}

function buildObsFcd(array $seed): string
{
    return str_pad($seed['ofcCd'], 5, '0', STR_PAD_LEFT)
        . str_pad($seed['itmkndCd'], 3, '0', STR_PAD_LEFT)
        . str_pad($seed['obsCd'], 5, '0', STR_PAD_LEFT);
}

function fetchLatestRainValues(string $obsFcd): array
{
    $tokyo = new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));
    $minute = (int)$tokyo->format('i');
    $rounded = $tokyo->setTime((int)$tokyo->format('H'), $minute - ($minute % 10));

    $attemptedUrls = [];
    for ($step = 0; $step < 36; $step++) {
        $candidate = $rounded->sub(new DateInterval('PT' . ($step * 10) . 'M'));
        $url = buildRainValuesUrl($obsFcd, $candidate);
        $attemptedUrls[] = $url;
        $response = fetchJsonUrl($url);
        if ($response['data'] !== null) {
            return [
                'data' => $response['data'],
                'source_url' => $url,
                'attempted_urls' => $attemptedUrls,
            ];
        }
    }

    return [
        'data' => null,
        'source_url' => null,
        'attempted_urls' => $attemptedUrls,
    ];
}

function buildRainValuesUrl(string $obsFcd, DateTimeImmutable $time): string
{
    $datePath = $time->format('Ymd/Hi');
    return "https://www.river.go.jp/kawabou/file/files/tmlist/rn/{$datePath}/{$obsFcd}.json";
}

function normalizeObservation(array $seed, string $obsFcd, array $master, ?array $values): array
{
    $obsInfo = is_array($master['obsInfo'] ?? null) ? $master['obsInfo'] : [];
    $obsValue = is_array($values['obsValue'] ?? null) ? $values['obsValue'] : [];
    $hourValues = array_values(array_filter($values['hrValues'] ?? [], 'is_array'));

    $lat = pickNumber($obsInfo, ['lat']) ?? $seed['lat'];
    $lon = pickNumber($obsInfo, ['lon']) ?? $seed['lon'];

    return [
        'type' => 'Feature',
        'geometry' => [
            'type' => 'Point',
            'coordinates' => [$lon, $lat],
        ],
        'properties' => [
            'id' => 'mlit-' . $obsFcd,
            'obsFcd' => $obsFcd,
            'name' => pickString($obsInfo, ['obsNm']) ?? ('MLIT rain ' . $seed['obsCd']),
            'provider' => 'MLIT',
            'providerLabel' => 'MLIT River Rain Gauge',
            'stationType' => 'MLIT rain observation',
            'isAmedas' => false,
            'ofcCd' => $seed['ofcCd'],
            'itmkndCd' => $seed['itmkndCd'],
            'obsCd' => $seed['obsCd'],
            'observedAt' => pickString($obsValue, ['obsTime']),
            'prefecture' => pickString($obsInfo, ['prefNm']),
            'city' => pickString($obsInfo, ['twnNm']),
            'address' => pickString($obsInfo, ['obsAdr']),
            'riverSystem' => pickString($obsInfo, ['rsysNm']),
            'river' => pickString($obsInfo, ['rvrNm']),
            'precipitation10m' => pickNumber($obsValue, ['rn10m']),
            'precipitation1h' => pickNumber($obsValue, ['rnHr']),
            'precipitation3h' => sumRainHours($hourValues, 3),
            'precipitation24h' => sumRainHours($hourValues, 24),
            'precipitationSinceEvent' => pickNumber($obsValue, ['rnInc']),
            'caution1h' => pickNumber($obsInfo, ['rnHrCaut']),
            'warning1h' => pickNumber($obsInfo, ['rnHrWarn']),
            'cautionSinceEvent' => pickNumber($obsInfo, ['rnIncCaut']),
            'warningSinceEvent' => pickNumber($obsInfo, ['rnIncWarn']),
        ],
    ];
}

function sumRainHours(array $rows, int $hours): ?float
{
    if ($hours <= 0 || count($rows) < $hours) {
        return null;
    }

    $sum = 0.0;
    for ($index = 0; $index < $hours; $index++) {
        $value = pickNumber($rows[$index], ['rnHr']);
        if ($value === null) {
            return null;
        }
        $sum += $value;
    }
    return $sum;
}

function pickString(array $data, array $keys): ?string
{
    foreach ($keys as $key) {
        if (isset($data[$key]) && is_scalar($data[$key])) {
            $value = trim((string)$data[$key]);
            if ($value !== '') {
                return $value;
            }
        }
    }
    return null;
}

function pickNumber(array $data, array $keys): ?float
{
    foreach ($keys as $key) {
        if (isset($data[$key]) && is_numeric($data[$key])) {
            return (float)$data[$key];
        }
    }
    return null;
}

function fetchJsonUrl(string $url): array
{
    $response = fetchUrl($url);
    if (!$response['ok']) {
        return ['data' => null, 'status' => $response['status'], 'error' => $response['error']];
    }

    $decoded = json_decode(trim($response['body']), true);
    return ['data' => is_array($decoded) ? $decoded : null, 'status' => $response['status'], 'error' => ''];
}

function fetchUrl(string $url): array
{
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_USERAGENT => 'tool.yql.jp mlit-rain-scraper',
            CURLOPT_HTTPHEADER => ['Accept: application/json, text/plain, */*'],
        ]);
        $body = curl_exec($ch);
        $status = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        return [
            'ok' => is_string($body) && $status >= 200 && $status < 300,
            'body' => is_string($body) ? $body : '',
            'status' => $status,
            'error' => $error,
        ];
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 10,
            'ignore_errors' => true,
            'header' => "Accept: application/json, text/plain, */*\r\nUser-Agent: tool.yql.jp mlit-rain-scraper\r\n",
        ],
    ]);
    $body = @file_get_contents($url, false, $context);
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $matches)) {
        $status = (int)$matches[1];
    }
    return [
        'ok' => is_string($body) && $status >= 200 && $status < 300,
        'body' => is_string($body) ? $body : '',
        'status' => $status,
        'error' => '',
    ];
}

function digits(string $value): string
{
    return preg_replace('/\D/', '', $value) ?? '';
}
