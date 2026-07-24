# A-PAB 放送エリアのめやす / 上限10件版

`tvarea/index.html` は `https://tv-area.jp/#/map/` の地図画面に近い構成で、`tv-area.jp` の公開 API を使って放送エリアを確認するローカル版です。

元サイト相当の基本動作に絞っています。

- 地図をダブルクリックして目的の地点を選択
- `target_tvstation` API の対象局を距離順で自動選択
- 選択できる中継局の上限を 5 件ではなく 10 件に変更
- 選択局ごとのポリゴン表示 ON/OFF
- 局名検索
- 地図上の局マーカーから手動選択

## データソース

- 局一覧: `https://tv-area.jp/api/marker/`
- 局名検索: `https://tv-area.jp/api/station_name/`
- 地点別対象局: `https://tv-area.jp/api/target_tvstation/`
- 局ポリゴン: `https://tv-area.jp/api/tvstation_by_no/`
