<?php
declare(strict_types=1);

/**
 * 国土交通省「川の防災情報」のデータを、この地図で必要な形だけに整えて返す API。
 * 外部 URL は利用者から受け取らず、固定した公式パスだけを取得する。
 */

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=300, stale-while-revalidate=300');

const MLIT_BASE_URLS = [
    'https://www.river.go.jp/kawabou/',
    'https://kawa6.river.go.jp/kawabou/',
];
const SOURCE_URL = 'https://www.river.go.jp/kawabou/';
const REQUEST_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    . '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_PREFECTURES_PER_REQUEST = 8;
const MAX_STATIONS_PER_REQUEST = 3000;
const MAX_WARNING_SHAPES = 40;

function respond(array $payload, int $status = 200): void
{
    http_response_code($status);
    echo json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
    );
    exit;
}

function fail_response(string $message, int $status = 500): void
{
    header('Cache-Control: no-store');
    respond(['error' => $message, 'sourceUrl' => SOURCE_URL], $status);
}

function cache_directory(): string
{
    static $checked = false;
    $dir = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'rivercam-mlit-cache';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    if (!$checked) {
        $checked = true;
        // 時刻入りURLのキャッシュが増え続けないよう、低確率で3日以前を掃除する。
        if (mt_rand(1, 50) === 1 && is_dir($dir)) {
            $cutoff = time() - 3 * 24 * 60 * 60;
            $files = glob($dir . DIRECTORY_SEPARATOR . '*');
            if (is_array($files)) {
                foreach ($files as $file) {
                    $name = basename($file);
                    if (preg_match('/^[a-f0-9]{40}\.json(?:\.fail)?$/', $name)
                        && is_file($file) && (int) @filemtime($file) < $cutoff) {
                        @unlink($file);
                    }
                }
            }
        }
    }
    return $dir;
}

function fetch_remote(string $url): ?string
{
    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        if ($handle === false) {
            return null;
        }
        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 12,
            CURLOPT_USERAGENT => REQUEST_USER_AGENT,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json, application/geo+json;q=0.9',
                'Accept-Language: ja,en-US;q=0.8,en;q=0.6',
                'Referer: ' . SOURCE_URL,
            ],
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $body = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        curl_close($handle);
        if (is_string($body) && $status >= 200 && $status < 300) {
            return $body;
        }
        // cURL のCA設定がない環境でも、PHP のストリーム設定で取得できる場合がある。
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'GET',
            'timeout' => 12,
            'ignore_errors' => true,
            'header' => implode("\r\n", [
                'Accept: application/json, application/geo+json;q=0.9',
                'Accept-Language: ja,en-US;q=0.8,en;q=0.6',
                'User-Agent: ' . REQUEST_USER_AGENT,
                'Referer: ' . SOURCE_URL,
            ]),
        ],
    ]);
    $body = @file_get_contents($url, false, $context);
    if (!is_string($body)) {
        return null;
    }
    $statusLine = isset($http_response_header[0]) ? (string) $http_response_header[0] : '';
    if ($statusLine !== '' && !preg_match('#\s2\d{2}\s#', $statusLine)) {
        return null;
    }
    return $body;
}

function fetch_json(string $path, int $ttlSeconds): array
{
    if ($path === '' || !preg_match('#^[A-Za-z0-9_./-]+\.json$#', $path)) {
        throw new RuntimeException('許可されていないデータパスです。');
    }

    $cacheFile = cache_directory() . DIRECTORY_SEPARATOR . sha1($path) . '.json';
    $failureFile = $cacheFile . '.fail';
    $cached = is_file($cacheFile) ? @file_get_contents($cacheFile) : false;
    $cacheIsFresh = is_string($cached)
        && (time() - (int) @filemtime($cacheFile)) < $ttlSeconds;

    if ($cacheIsFresh) {
        $decoded = json_decode($cached, true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }

    if (!is_string($cached) && is_file($failureFile)
        && (time() - (int) @filemtime($failureFile)) < 60) {
        throw new RuntimeException('直前に取得できなかったデータです。');
    }

    foreach (MLIT_BASE_URLS as $baseUrl) {
        $body = fetch_remote($baseUrl . $path);
        if (!is_string($body)) {
            continue;
        }
        $decoded = json_decode($body, true);
        if (is_array($decoded)) {
            if (is_dir(dirname($cacheFile)) && is_writable(dirname($cacheFile))) {
                @file_put_contents($cacheFile, $body, LOCK_EX);
                if (is_file($failureFile)) {
                    @unlink($failureFile);
                }
            }
            return $decoded;
        }
    }

    // 公式側が一時的に応答しない場合は、期限切れでも直近の正常値を使う。
    if (is_string($cached)) {
        $decoded = json_decode($cached, true);
        if (is_array($decoded)) {
            return $decoded;
        }
    }

    if (is_dir(dirname($failureFile)) && is_writable(dirname($failureFile))) {
        @touch($failureFile);
    }
    throw new RuntimeException('国土交通省のデータを取得できませんでした。');
}

function current_time_info(string $kind): array
{
    $isWarning = $kind === 'warning';
    $file = $isWarning ? 'file/system/rwCrntTime.json' : 'file/system/tmCrntTime.json';
    $key = $isWarning ? 'crntRwTime' : 'crntObsTime';
    $json = fetch_json($file, 300);
    $value = isset($json[$key]) ? (string) $json[$key] : '';
    if (!preg_match('#^(\d{4})/(\d{2})/(\d{2}) (\d{2}):(\d{2})$#', $value, $matches)) {
        throw new RuntimeException('更新時刻の形式を確認できませんでした。');
    }
    return [
        'display' => $value,
        'date' => $matches[1] . $matches[2] . $matches[3],
        'time' => $matches[4] . $matches[5],
    ];
}

function number_or_null($value): ?float
{
    return is_numeric($value) ? (float) $value : null;
}

function integer_or_null($value): ?int
{
    return is_numeric($value) ? (int) $value : null;
}

function normalize_station(array $feature, ?array $bounds = null, ?string $referenceTime = null): ?array
{
    $geometry = isset($feature['geometry']) && is_array($feature['geometry'])
        ? $feature['geometry']
        : [];
    $coordinates = isset($geometry['coordinates']) && is_array($geometry['coordinates'])
        ? $geometry['coordinates']
        : [];
    $properties = isset($feature['properties']) && is_array($feature['properties'])
        ? $feature['properties']
        : [];

    $longitude = number_or_null($coordinates[0] ?? null);
    $latitude = number_or_null($coordinates[1] ?? null);
    $id = isset($properties['obs_fcd']) ? (string) $properties['obs_fcd'] : '';
    if ($longitude === null || $latitude === null || !preg_match('/^\d{5}004\d{5}$/', $id)) {
        return null;
    }
    if ($bounds !== null && (
        $latitude < $bounds['south'] || $latitude > $bounds['north']
        || $longitude < $bounds['west'] || $longitude > $bounds['east']
    )) {
        return null;
    }

    $thresholdKeys = ['rsrv_stg', 'warn_stg', 'spcl_warn_stg', 'dng_stg'];
    $hasThreshold = false;
    foreach ($thresholdKeys as $thresholdKey) {
        if (number_or_null($properties[$thresholdKey] ?? null) !== null) {
            $hasThreshold = true;
            break;
        }
    }

    $level = integer_or_null($properties['stg_ovlvl'] ?? null) ?? 0;
    // 全国の基準超過地点ファイルは基準値と品質コードを省略するが、判定レベル自体は有効。
    if ($level > 0) {
        $hasThreshold = true;
    }
    $conditionCode = integer_or_null($properties['stg_ccd'] ?? null);
    $hasConditionCode = array_key_exists('stg_ccd', $properties);
    $isMissing = $hasConditionCode && ($conditionCode === null || $conditionCode >= 128);
    $isStale = false;
    $observedAt = isset($properties['obs_time']) ? (string) $properties['obs_time'] : '';
    if ($referenceTime !== null && $observedAt !== '') {
        $referenceDate = parse_japan_time($referenceTime);
        $observedDate = parse_japan_time($observedAt);
        $isStale = $referenceDate !== null && $observedDate !== null
            && ($referenceDate->getTimestamp() - $observedDate->getTimestamp()) > 2 * 60 * 60;
        $isMissing = $isMissing || $isStale;
    }

    return [
        'id' => $id,
        'name' => (string) ($properties['obs_nm'] ?? '名称不明'),
        'lat' => $latitude,
        'lng' => $longitude,
        'observedAt' => $observedAt !== '' ? $observedAt : null,
        'level' => $level,
        'missing' => $isMissing,
        'stale' => $isStale,
        'thresholdsConfigured' => $hasThreshold,
        'change' => number_or_null($properties['stg_ltst_chg'] ?? null),
        'changeCondition' => integer_or_null($properties['stg_ltst_chg_ccd'] ?? null),
    ];
}

function request_bound(string $name, float $minimum, float $maximum): float
{
    $raw = $_GET[$name] ?? null;
    if (!is_string($raw) || !is_numeric($raw)) {
        throw new InvalidArgumentException('表示範囲が正しくありません。');
    }
    $value = (float) $raw;
    if (!is_finite($value) || $value < $minimum || $value > $maximum) {
        throw new InvalidArgumentException('表示範囲が正しくありません。');
    }
    return $value;
}

function bounds_intersect(array $prefecture, array $bounds): bool
{
    $minLon = number_or_null($prefecture['minLon'] ?? null);
    $minLat = number_or_null($prefecture['minLat'] ?? null);
    $maxLon = number_or_null($prefecture['maxLon'] ?? null);
    $maxLat = number_or_null($prefecture['maxLat'] ?? null);
    if ($minLon === null || $minLat === null || $maxLon === null || $maxLat === null) {
        return false;
    }
    return !(
        $maxLon < $bounds['west'] || $minLon > $bounds['east']
        || $maxLat < $bounds['south'] || $minLat > $bounds['north']
    );
}

function gauges_response(): void
{
    $time = current_time_info('observation');
    $overview = isset($_GET['overview']) && $_GET['overview'] === '1';
    $stationsById = [];
    $tooWide = false;
    $prefectureCount = 0;

    if ($overview) {
        $geojson = fetch_json(
            'file/gjson/overobs/stg/' . $time['date'] . '/' . $time['time'] . '/over-obs-create.json',
            300
        );
        $features = isset($geojson['features']) && is_array($geojson['features'])
            ? $geojson['features']
            : [];
        foreach ($features as $feature) {
            if (!is_array($feature)) {
                continue;
            }
            $station = normalize_station($feature, null, $time['display']);
            if ($station !== null) {
                $stationsById[$station['id']] = $station;
            }
        }
    } else {
        $bounds = [
            'north' => request_bound('north', -90, 90),
            'south' => request_bound('south', -90, 90),
            'east' => request_bound('east', -180, 180),
            'west' => request_bound('west', -180, 180),
        ];
        if ($bounds['north'] <= $bounds['south'] || $bounds['east'] <= $bounds['west']) {
            throw new InvalidArgumentException('表示範囲が正しくありません。');
        }

        $prefectureJson = fetch_json('file/files/map/pref/prefarea.json', 86400);
        $prefectures = isset($prefectureJson['prefs']) && is_array($prefectureJson['prefs'])
            ? $prefectureJson['prefs']
            : [];
        $selected = [];
        foreach ($prefectures as $prefecture) {
            if (is_array($prefecture) && bounds_intersect($prefecture, $bounds)) {
                $selected[] = $prefecture;
            }
        }
        $prefectureCount = count($selected);
        if ($prefectureCount > MAX_PREFECTURES_PER_REQUEST) {
            $tooWide = true;
            $selected = array_slice($selected, 0, MAX_PREFECTURES_PER_REQUEST);
        }

        foreach ($selected as $prefecture) {
            $prefectureCode = isset($prefecture['prefCd']) ? (string) $prefecture['prefCd'] : '';
            if (!preg_match('/^\d{3,4}$/', $prefectureCode)) {
                continue;
            }
            try {
                $geojson = fetch_json(
                    'file/gjson/obs/' . $time['date'] . '/' . $time['time'] . '/stg/' . $prefectureCode . '.json',
                    300
                );
            } catch (RuntimeException $error) {
                continue;
            }
            $features = isset($geojson['features']) && is_array($geojson['features'])
                ? $geojson['features']
                : [];
            foreach ($features as $feature) {
                if (!is_array($feature)) {
                    continue;
                }
                $station = normalize_station($feature, $bounds, $time['display']);
                if ($station !== null) {
                    $stationsById[$station['id']] = $station;
                }
                if (count($stationsById) >= MAX_STATIONS_PER_REQUEST) {
                    $tooWide = true;
                    break 2;
                }
            }
        }
    }

    respond([
        'updatedAt' => $time['display'],
        'overview' => $overview,
        'tooWide' => $tooWide,
        'prefectureCount' => $prefectureCount,
        'stations' => array_values($stationsById),
        'sourceUrl' => SOURCE_URL,
    ]);
}

function warning_level_label(string $type, int $level): string
{
    if ($type === 'fldctl') {
        return [10 => '待機', 20 => '準備', 40 => '出動'][$level] ?? '水防警報';
    }
    return [
        30 => '氾濫注意情報',
        60 => '氾濫警戒情報',
        80 => '氾濫危険情報',
        90 => '氾濫発生情報',
    ][$level] ?? '河川警報';
}

function warnings_response(): void
{
    $time = current_time_info('warning');
    $list = fetch_json(
        'file/files/rw/list/pref/' . $time['date'] . '/' . $time['time'] . '/80.json',
        300
    );
    $warnings = [];

    $floodItems = isset($list['fldfr']) && is_array($list['fldfr']) ? $list['fldfr'] : [];
    foreach ($floodItems as $item) {
        if (!is_array($item)) {
            continue;
        }
        $type = isset($item['type']) ? (string) $item['type'] : '';
        $level = integer_or_null($item['lvl'] ?? null) ?? 0;
        $code = isset($item['cd']) ? (string) $item['cd'] : '';
        if (!in_array($type, ['fldfr', 'evstg'], true) || $level <= 0 || !preg_match('/^\d{10}$/', $code)) {
            continue;
        }
        $warnings[] = [
            'type' => $type,
            'code' => $code,
            'name' => (string) ($item['nm'] ?? '名称不明'),
            'level' => $level,
            'levelLabel' => warning_level_label($type, $level),
            'kind' => (string) ($item['kndNm'] ?? ''),
            'announcedAt' => isset($item['annTime']) ? (string) $item['annTime'] : null,
            'heading' => isset($item['heading']) ? (string) $item['heading'] : '',
        ];
    }

    $controlItems = isset($list['fldctl']) && is_array($list['fldctl']) ? $list['fldctl'] : [];
    foreach ($controlItems as $item) {
        if (!is_array($item)) {
            continue;
        }
        $level = integer_or_null($item['fldctlLvl'] ?? null) ?? 0;
        $code = isset($item['fldctlCd']) ? (string) $item['fldctlCd'] : '';
        if ($level <= 0 || !preg_match('/^\d{10}$/', $code)) {
            continue;
        }
        $warnings[] = [
            'type' => 'fldctl',
            'code' => $code,
            'name' => (string) ($item['fldctlNm'] ?? '名称不明'),
            'level' => $level,
            'levelLabel' => warning_level_label('fldctl', $level),
            'kind' => (string) ($item['fldctlKndNm'] ?? ''),
            'announcedAt' => isset($item['annTime']) ? (string) $item['annTime'] : null,
            'heading' => isset($item['heading']) ? (string) $item['heading'] : '',
        ];
    }

    usort($warnings, static function (array $left, array $right): int {
        return $right['level'] <=> $left['level'];
    });

    $features = [];
    $renderedWarnings = [];
    $limitedWarnings = array_slice($warnings, 0, MAX_WARNING_SHAPES);
    foreach ($limitedWarnings as $warning) {
        try {
            $shape = fetch_json(
                'file/gjson/rw/' . $warning['type'] . '/' . $warning['code'] . '.json',
                86400
            );
        } catch (RuntimeException $error) {
            continue;
        }
        $shapeFeatures = isset($shape['features']) && is_array($shape['features'])
            ? $shape['features']
            : [];
        foreach ($shapeFeatures as $feature) {
            if (!is_array($feature) || !isset($feature['geometry'])) {
                continue;
            }
            $feature['properties'] = $warning;
            $features[] = $feature;
            $renderedWarnings[$warning['type'] . ':' . $warning['code']] = true;
        }
    }

    respond([
        'updatedAt' => $time['display'],
        'warnings' => $warnings,
        'renderedWarningCount' => count($renderedWarnings),
        'geojson' => [
            'type' => 'FeatureCollection',
            'features' => $features,
        ],
        'truncated' => count($warnings) > MAX_WARNING_SHAPES,
        'sourceUrl' => SOURCE_URL,
    ]);
}

function valid_series_point(array $point, int $intervalMinutes = 60): ?array
{
    $value = number_or_null($point['stg'] ?? null);
    $condition = integer_or_null($point['stgCcd'] ?? null);
    $observedAt = isset($point['obsTime']) ? (string) $point['obsTime'] : '';
    if ($value === null || $condition === null || $condition >= 128
        || !preg_match('#^\d{4}/\d{2}/\d{2} \d{2}:\d{2}$#', $observedAt)) {
        return null;
    }
    return [
        'time' => $observedAt,
        'value' => $value,
        'intervalMinutes' => $intervalMinutes,
    ];
}

function parse_japan_time(string $value): ?DateTimeImmutable
{
    $timezone = new DateTimeZone('Asia/Tokyo');
    $date = DateTimeImmutable::createFromFormat('!Y/m/d H:i', $value, $timezone);
    return $date instanceof DateTimeImmutable ? $date : null;
}

function gauge_detail_response(): void
{
    $stationId = isset($_GET['id']) ? (string) $_GET['id'] : '';
    if (!preg_match('/^\d{5}004\d{5}$/', $stationId)) {
        throw new InvalidArgumentException('水位観測所 ID が正しくありません。');
    }

    $time = current_time_info('observation');
    $master = fetch_json('file/files/master/obs/stg/' . $stationId . '.json', 86400);
    $current = fetch_json(
        'file/files/tmlist/stg/' . $time['date'] . '/' . $time['time'] . '/' . $stationId . '.json',
        300
    );
    try {
        $past = fetch_json(
            'file/files/tmlist/past/stg/' . $time['date'] . '/' . $stationId . '.json',
            900
        );
    } catch (RuntimeException $error) {
        $past = [];
    }

    $info = isset($master['obsInfo']) && is_array($master['obsInfo']) ? $master['obsInfo'] : [];
    $currentValue = isset($current['obsValue']) && is_array($current['obsValue'])
        ? $current['obsValue']
        : [];

    $pointsByTime = [];
    $pastValues = isset($past['pastValues']) && is_array($past['pastValues']) ? $past['pastValues'] : [];
    $hourValues = isset($current['hrValues']) && is_array($current['hrValues']) ? $current['hrValues'] : [];
    $min10Values = isset($current['min10Values']) && is_array($current['min10Values'])
        ? $current['min10Values']
        : [];
    foreach ([
        [$pastValues, 60],
        [$hourValues, 60],
        [$min10Values, 10],
        [[$currentValue], 10],
    ] as [$values, $intervalMinutes]) {
        foreach ($values as $point) {
            if (!is_array($point)) {
                continue;
            }
            $normalized = valid_series_point($point, $intervalMinutes);
            if ($normalized !== null) {
                // 10分値を後から入れ、同時刻の時間値より優先する。
                $pointsByTime[$normalized['time']] = $normalized;
            }
        }
    }
    ksort($pointsByTime);

    $referenceDate = parse_japan_time($time['display']);
    $cutoff = $referenceDate ? $referenceDate->modify('-72 hours') : null;
    $series = [];
    foreach ($pointsByTime as $point) {
        $pointDate = parse_japan_time($point['time']);
        if ($cutoff === null || ($pointDate !== null && $pointDate >= $cutoff)) {
            $series[] = $point;
        }
    }
    $series10mCount = 0;
    foreach ($series as $point) {
        if (($point['intervalMinutes'] ?? 60) === 10) {
            $series10mCount++;
        }
    }

    $currentCondition = integer_or_null($currentValue['stgCcd'] ?? null);
    $currentStage = ($currentCondition !== null && $currentCondition < 128)
        ? number_or_null($currentValue['stg'] ?? null)
        : null;

    respond([
        'updatedAt' => $time['display'],
        'station' => [
            'id' => $stationId,
            'name' => (string) ($info['obsNm'] ?? '名称不明'),
            'riverSystem' => (string) ($info['rsysNm'] ?? ''),
            'river' => (string) ($info['rvrNm'] ?? ''),
            'address' => (string) ($info['obsAdr'] ?? ''),
            'office' => (string) ($info['jrsNm'] ?? ''),
            'lat' => number_or_null($info['lat'] ?? null),
            'lng' => number_or_null($info['lon'] ?? null),
        ],
        'current' => [
            'value' => $currentStage,
            'observedAt' => isset($currentValue['obsTime']) ? (string) $currentValue['obsTime'] : null,
            'level' => integer_or_null($currentValue['stgOvlvl'] ?? null) ?? 0,
            'change10m' => number_or_null($currentValue['stg10mChg'] ?? null),
            'missing' => $currentStage === null,
        ],
        'thresholds' => [
            ['key' => 'standby', 'label' => '水防団待機水位', 'value' => number_or_null($info['rsrvStg'] ?? null), 'color' => '#35a86b'],
            ['key' => 'caution', 'label' => '氾濫注意水位', 'value' => number_or_null($info['warnStg'] ?? null), 'color' => '#c6bc00'],
            ['key' => 'evacuation', 'label' => '避難判断水位', 'value' => number_or_null($info['spclWarnStg'] ?? null), 'color' => '#ff2800'],
            ['key' => 'danger', 'label' => '氾濫危険水位', 'value' => number_or_null($info['dngStg'] ?? null), 'color' => '#aa00aa'],
            ['key' => 'flood', 'label' => '氾濫発生水位', 'value' => number_or_null($info['fldStg'] ?? null), 'color' => '#140014'],
        ],
        'series' => $series,
        'series10mCount' => $series10mCount,
        'sourceUrl' => SOURCE_URL,
    ]);
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    fail_response('GET リクエストだけを利用できます。', 405);
}

$action = isset($_GET['action']) ? (string) $_GET['action'] : '';
try {
    switch ($action) {
        case 'gauges':
            gauges_response();
            break;
        case 'warnings':
            warnings_response();
            break;
        case 'gauge-detail':
            gauge_detail_response();
            break;
        default:
            throw new InvalidArgumentException('action が正しくありません。');
    }
} catch (InvalidArgumentException $error) {
    fail_response($error->getMessage(), 400);
} catch (Throwable $error) {
    error_log('[river_data] ' . $error->getMessage());
    fail_response('河川データを取得できませんでした。しばらくしてから再度お試しください。', 502);
}
