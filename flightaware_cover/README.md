# ADS-B Coverage Viewer

FlightAware の `Feeder Sites` をピン表示し、`Data Coverage` のカバレッジタイルを重ねて表示するサイトです。

## FlightAware 連携について

依頼元ページは [FlightAware ADS-B Coverage Map - Data Coverage](https://ja.flightaware.com/adsb/coverage/#data-coverage) です。このプロジェクトでは、ユーザーが FlightAware から取得・再表示の許可を得ているという確認に基づき、同ページが利用する `https://www.flightaware.com/ajax/adsb/sites_map.rvt` を取得し、Data Coverage 用の `https://www.flightaware.com/coverage_map/img_{source}_latest/{altitude}/{z}/{x}_{y}.png` タイルを表示します。

FlightAware の [Terms of Use](https://www.flightaware.com/about/terms-of-use/) 上、許可のない自動取得や再表示には使用しないでください。許可範囲に認証、取得頻度、表示項目などの条件がある場合は、それに合わせて `proxy.php` を調整して運用します。

## 使い方

1. PHP が動作する Web サーバーでこのディレクトリを公開し、`index.html` を開きます。
2. 初期表示時に `proxy.php` が FlightAware の Feeder Sites を取得してピン表示し、Data Coverage の公開レイヤーを地図へ重ねます。
3. `Data Coverage` 欄で表示のオン/オフ、高度、ADS-B / UAT / MLAT / Radar / Oceanic / Space-based ADS-B の各レイヤーを切り替えられます。
4. `最新ピンを取得` は通常キャッシュより早く再取得しますが、サーバー側で最短 60 秒の間隔を保ちます。
5. `ファイルを選択` またはドラッグ＆ドロップでは `GeoJSON`、`JSON`、`CSV` も表示できます。
6. `デモを表示` は UI 確認用で、[data/sample-sites.geojson](data/sample-sites.geojson) の地点は FlightAware 由来ではありません。

## 取得処理

- [proxy.php](proxy.php) は取得先を `sites_map.rvt` に固定しています。任意 URL のプロキシにはなりません。
- FlightAware の HTML 内に埋め込まれた `var data = [...]` 配列を JSON レスポンスとして返します。
- レスポンスは `cache/flightaware-sites.json` に通常 5 分間キャッシュされ、手動更新でも最短 60 秒は再利用されます。
- ピンにはサイト名、種別、地域、追加日、Site ID、緯度経度を表示します。
- Data Coverage はブラウザが FlightAware の透明画像タイルを直接読み込み、公式ページと同じ公開 6 レイヤーおよび高度区分に対応します。

## データ形式

追加で読み込むファイルの GeoJSON は `Point` の `FeatureCollection` に対応します。

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [139.6917, 35.6895] },
      "properties": {
        "name": "Receiver A",
        "type": "PiAware",
        "frequency": "1090 MHz",
        "location": "Tokyo"
      }
    }
  ]
}
```

JSON の配列または CSV では、少なくとも緯度経度を指定します。

```csv
name,type,frequency,latitude,longitude,location
Receiver A,PiAware,1090 MHz,35.6895,139.6917,Tokyo
```

緯度は `latitude` または `lat`、経度は `longitude`、`lon`、`lng` の名称を認識します。
