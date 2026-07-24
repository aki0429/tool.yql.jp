<?php
declare(strict_types=1);

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Method not allowed'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

if (isset($_GET['ping'])) {
    http_response_code(204);
    exit;
}

$requestedTime = isset($_GET['time']) ? preg_replace('/\D/', '', (string) $_GET['time']) : '';
$result = $requestedTime !== '' ? fetchEewByTime(substr($requestedTime, 0, 14)) : fetchLatestEew();

if ($result === null) {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');

echo json_encode([
    'resolved_time' => $result['resolved_time'],
    'source_url' => $result['source_url'],
    'data' => $result['data'],
], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

function fetchEewByTime(string $time): ?array
{
    if (strlen($time) !== 14) {
        return null;
    }

    $sourceUrl = buildEewUrl($time);
    $response = fetchUrl($sourceUrl);
    if (!$response['ok']) {
        return null;
    }

    $data = decodeJsonpPayload($response['body']);
    if ($data === null) {
        return null;
    }

    return [
        'resolved_time' => $time,
        'source_url' => $sourceUrl,
        'data' => $data,
    ];
}

function fetchLatestEew(): ?array
{
    $latestUrl = 'http://www.kmoni.bosai.go.jp/webservice/hypo/eew/latest.json?jsoncallback=proxyCallback';
    $response = fetchUrl($latestUrl);
    if ($response['ok']) {
        $data = decodeJsonpPayload($response['body']);
        if ($data !== null) {
            $resolvedTime = extractTimestamp($data) ?: (new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo')))->format('YmdHis');
            return [
                'resolved_time' => $resolvedTime,
                'source_url' => $latestUrl,
                'data' => $data,
            ];
        }
    }

    $now = new DateTimeImmutable('now', new DateTimeZone('Asia/Tokyo'));
    for ($offset = 0; $offset <= 10; $offset++) {
        $candidate = $now->modify("-{$offset} seconds")->format('YmdHis');
        $result = fetchEewByTime($candidate);
        if ($result !== null) {
            return $result;
        }
    }

    return null;
}

function buildEewUrl(string $time): string
{
    return sprintf(
        'http://www.kmoni.bosai.go.jp/webservice/hypo/eew/%s.json?jsoncallback=proxyCallback',
        rawurlencode($time)
    );
}

function decodeJsonpPayload(string $body): ?array
{
    $body = trim($body);
    if ($body === '') {
        return null;
    }

    if ($body[0] === '{' || $body[0] === '[') {
        $decoded = json_decode($body, true);
        return is_array($decoded) ? $decoded : null;
    }

    $start = strpos($body, '(');
    $end = strrpos($body, ')');
    if ($start === false || $end === false || $end <= $start) {
        return null;
    }

    $json = substr($body, $start + 1, $end - $start - 1);
    $decoded = json_decode($json, true);
    return is_array($decoded) ? $decoded : null;
}

function extractTimestamp(array $data): string
{
    foreach (['request_time', 'report_time', 'time'] as $key) {
        if (!isset($data[$key])) {
            continue;
        }

        $candidate = preg_replace('/\D/', '', (string) $data[$key]);
        if (strlen($candidate) >= 14) {
            return substr($candidate, 0, 14);
        }
    }

    foreach (['result.request_time', 'result.report_time', 'result.time'] as $path) {
        $candidate = extractPath($data, $path);
        if ($candidate === null) {
            continue;
        }

        $candidate = preg_replace('/\D/', '', (string) $candidate);
        if (strlen($candidate) >= 14) {
            return substr($candidate, 0, 14);
        }
    }

    return '';
}

function extractPath(array $data, string $path)
{
    $value = $data;
    foreach (explode('.', $path) as $key) {
        if (!is_array($value) || !array_key_exists($key, $value)) {
            return null;
        }
        $value = $value[$key];
    }

    return $value;
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
            CURLOPT_USERAGENT => 'tool.ikunocam.net JQuake EEW proxy',
            CURLOPT_HTTPHEADER => ['Accept: application/javascript, application/json'],
        ]);

        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        return [
            'ok' => $body !== false && $status >= 200 && $status < 300,
            'body' => is_string($body) ? $body : '',
            'status' => $status,
            'error' => $error,
        ];
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 10,
            'header' => "Accept: application/javascript, application/json\r\nUser-Agent: tool.ikunocam.net JQuake EEW proxy\r\n",
        ],
    ]);
    $body = @file_get_contents($url, false, $context);
    $status = 0;

    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $matches)) {
        $status = (int) $matches[1];
    }

    return [
        'ok' => $body !== false && $status >= 200 && $status < 300,
        'body' => is_string($body) ? $body : '',
        'status' => $status,
        'error' => '',
    ];
}
