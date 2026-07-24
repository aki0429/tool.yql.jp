<?php
declare(strict_types=1);

const SOURCE_URL = 'https://www.flightaware.com/ajax/adsb/sites_map.rvt';
const SOURCE_REFERER = 'https://www.flightaware.com/adsb/coverage/';
const CACHE_TTL_SECONDS = 300;
const MANUAL_REFRESH_MIN_INTERVAL_SECONDS = 60;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=60');

$cacheDirectory = __DIR__ . DIRECTORY_SEPARATOR . 'cache';
$cachePath = $cacheDirectory . DIRECTORY_SEPARATOR . 'flightaware-sites.json';
$forceRefresh = isset($_GET['refresh']) && $_GET['refresh'] === '1';
$cacheMaxAge = $forceRefresh ? MANUAL_REFRESH_MIN_INTERVAL_SECONDS : CACHE_TTL_SECONDS;

if (isFreshCache($cachePath, $cacheMaxAge)) {
    readfile($cachePath);
    exit;
}

try {
    $html = fetchCoverageHtml();
    $embeddedData = extractDataArray($html);
    $sourceUpdatedAt = extractUpdatedAt($html);
    $payload = '{"source":' . json_encode(SOURCE_URL, JSON_UNESCAPED_SLASHES)
        . ',"retrievedAt":' . json_encode(gmdate('c'))
        . ',"sourceUpdatedAt":' . json_encode($sourceUpdatedAt)
        . ',"sites":' . $embeddedData . '}';

    if (!is_dir($cacheDirectory)) {
        @mkdir($cacheDirectory, 0775, true);
    }
    if (is_dir($cacheDirectory)) {
        @file_put_contents($cachePath, $payload, LOCK_EX);
    }

    echo $payload;
} catch (Throwable $exception) {
    if (is_file($cachePath)) {
        header('Warning: 110 - "Serving stale cached FlightAware feeder site data"');
        readfile($cachePath);
        exit;
    }

    http_response_code(502);
    echo json_encode([
        'error' => 'FlightAware feeder site data could not be retrieved.',
        'detail' => $exception->getMessage(),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}

function isFreshCache(string $cachePath, int $maxAge): bool
{
    return is_file($cachePath) && filemtime($cachePath) >= (time() - $maxAge);
}

function fetchCoverageHtml(): string
{
    if (function_exists('curl_init')) {
        $curl = curl_init(SOURCE_URL);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 35,
            CURLOPT_USERAGENT => 'Authorized ADS-B Coverage Viewer/1.0',
            CURLOPT_REFERER => SOURCE_REFERER,
            CURLOPT_HTTPHEADER => ['Accept: text/html'],
        ]);
        $html = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $error = curl_error($curl);
        curl_close($curl);

        if (!is_string($html) || $status !== 200) {
            throw new RuntimeException('FlightAware request failed: HTTP ' . $status . ' ' . $error);
        }
        return $html;
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Accept: text/html\r\n"
                . "Referer: " . SOURCE_REFERER . "\r\n"
                . "User-Agent: Authorized ADS-B Coverage Viewer/1.0\r\n",
            'timeout' => 35,
            'ignore_errors' => true,
        ],
        'ssl' => [
            'verify_peer' => true,
            'verify_peer_name' => true,
        ],
    ]);
    $html = @file_get_contents(SOURCE_URL, false, $context);

    if (!is_string($html)) {
        throw new RuntimeException('FlightAware request failed.');
    }
    return $html;
}

function extractDataArray(string $html): string
{
    $markerPosition = strpos($html, 'var data =');
    if ($markerPosition === false) {
        throw new RuntimeException('Embedded site data marker was not found.');
    }

    $start = strpos($html, '[', $markerPosition);
    if ($start === false) {
        throw new RuntimeException('Embedded site data array was not found.');
    }

    $depth = 0;
    $inString = false;
    $escaped = false;
    $length = strlen($html);

    for ($index = $start; $index < $length; $index++) {
        $character = $html[$index];

        if ($inString) {
            if ($escaped) {
                $escaped = false;
            } elseif ($character === '\\') {
                $escaped = true;
            } elseif ($character === '"') {
                $inString = false;
            }
            continue;
        }

        if ($character === '"') {
            $inString = true;
        } elseif ($character === '[') {
            $depth++;
        } elseif ($character === ']') {
            $depth--;
            if ($depth === 0) {
                return substr($html, $start, $index - $start + 1);
            }
        }
    }

    throw new RuntimeException('Embedded site data array was incomplete.');
}

function extractUpdatedAt(string $html): string
{
    if (preg_match('/datetime="([^"]+)"/', $html, $matches) === 1) {
        return $matches[1];
    }
    return '';
}
