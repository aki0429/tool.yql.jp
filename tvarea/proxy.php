<?php
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Methods: GET, OPTIONS");
header("Access-Control-Allow-Headers: Content-Type");
header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");

if ($_SERVER["REQUEST_METHOD"] === "OPTIONS") {
    http_response_code(204);
    exit;
}

function respond_json($payload, int $status = 200): void {
    http_response_code($status);
    header("Content-Type: application/json; charset=UTF-8");
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fetch_remote_text(string $url): array {
    if (function_exists("curl_init")) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_USERAGENT => "Mozilla/5.0",
            CURLOPT_FAILONERROR => false,
        ]);

        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($body === false || $status < 200 || $status >= 300) {
            return ["ok" => false, "status" => $status ?: 502, "error" => $error ?: "remote fetch failed"];
        }

        return ["ok" => true, "body" => $body];
    }

    $context = stream_context_create([
        "http" => [
            "method" => "GET",
            "timeout" => 30,
            "ignore_errors" => true,
            "header" => "User-Agent: Mozilla/5.0\r\n",
        ],
    ]);

    $body = @file_get_contents($url, false, $context);
    if ($body === false || $body === "") {
        return ["ok" => false, "status" => 502, "error" => "remote fetch failed"];
    }

    return ["ok" => true, "body" => $body];
}

function proxy_passthrough_json(string $url): void {
    $result = fetch_remote_text($url);
    if (!$result["ok"]) {
        respond_json(["error" => $result["error"]], $result["status"]);
    }

    header("Content-Type: application/json; charset=UTF-8");
    echo $result["body"];
    exit;
}

function require_numeric_param(string $name): float {
    if (!isset($_GET[$name]) || !is_numeric($_GET[$name])) {
        respond_json(["error" => $name . " is required"], 400);
    }

    return (float) $_GET[$name];
}

$mode = $_GET["mode"] ?? "";

switch ($mode) {
    case "markers":
        proxy_passthrough_json("https://tv-area.jp/api/marker/");
        break;

    case "target":
        $lat = require_numeric_param("lat");
        $lng = require_numeric_param("lng");
        proxy_passthrough_json(
            "https://tv-area.jp/api/target_tvstation/?lat=" . rawurlencode((string) $lat)
            . "&lng=" . rawurlencode((string) $lng)
        );
        break;

    case "tvstation":
        $id = $_GET["id"] ?? "";
        if (!preg_match('/^\d+$/', (string) $id)) {
            respond_json(["error" => "numeric id is required"], 400);
        }
        proxy_passthrough_json("https://tv-area.jp/api/tvstation_by_no/?id=" . rawurlencode((string) $id));
        break;

    case "station_name":
        $name = trim((string) ($_GET["name"] ?? ""));
        if ($name === "") {
            respond_json([]);
        }
        proxy_passthrough_json("https://tv-area.jp/api/station_name/?name=" . rawurlencode($name));
        break;

    case "prefecture_stations":
        $prefecture = trim((string) ($_GET["prefecture"] ?? ""));
        if ($prefecture === "") {
            respond_json([]);
        }
        proxy_passthrough_json("https://tv-area.jp/api/prefecture_stations/?prefecture=" . rawurlencode($prefecture));
        break;

    default:
        respond_json(["error" => "unknown mode"], 404);
}
