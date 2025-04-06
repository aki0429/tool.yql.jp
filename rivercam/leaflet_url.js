// Leaflet用URLハンドラ
//  地図を移動すると、URLを緯度経度ズーム付きURLに変更する
//  URLに緯度経度ズームが付加されている場合は、その位置の地図を表示する
//  マップオブジェクトを作成後、下記メソッドを記述することで利用可能
//  L.urlHandler(map);
// 作成者: Joe Masumura (ASH Corporation.)

L.UrlHandler = L.Handler.extend({ // Leaflet用URLハンドラの登録
  initialize: function(map) {
	L.Handler.prototype.initialize.call(this, map); // デフォルト処理

	let [path, param] = location.href.split('@'); // URLの解析

	if (! path.includes('?')) path += '?';
	this._path = path; // URLパスの設定

	if (typeof param != 'undefined') { // 位置情報が付加されている場合
	  let [lat, lng, zoom] = param.split(',');
	  if ((typeof zoom != 'undefined') && (zoom >= 0) && (zoom <= 24)) {
		map.setView([lat, lng], parseInt(zoom)); // 位置情報を設定
		this._lat = lat;
		this._lng = lng;
		this._zoom = zoom;
	  }
	}
	this.enable(map); // URL置換処理を有効化
	this._chgUrl(); // URL欄の初期表示
  },

  addHooks: function() { // enableから呼ばれるメソッド
	this._map.on('moveend', this._chgUrl, this);
  },

  removeHooks: function() { // disableから呼ばれるメソッド
	this._map.off('moveend', this._chgUrl, this);
  },

  _chgUrl: function(e) { // URL変更処理
	let coord = this._map.getCenter().wrap();
	let lat = Math.round(coord.lat * 1000000) / 1000000;
	let lng = Math.round(coord.lng * 1000000) / 1000000;
	let zoom = parseInt(this._map.getZoom()); // 小数点を切り捨てて整数にする
	let url = this._path + '@' + [lat, lng, zoom].join(',');
	history.replaceState(null, null, url);
  }
});

L.urlHandler = function(map) { // 小文字で始まるショートカットの定義
  return new L.UrlHandler(map);
};