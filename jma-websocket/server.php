<?php
/**
 * server.php (最終版)
 *
 * WebSocketサーバーとして、気象庁の防災情報をリアルタイムで提供します。
 * サーバー起動時に基準データを取得し、以後15秒ごとに更新をチェック。
 * 更新が検知された場合のみ、全クライアントにデータをブロードキャストします。
 *
 * @version 7.0 (Final)
 * @author Gemini
 */

// 必要なファイルを読み込む
require 'vendor/autoload.php';
require 'jma_functions.php';

use Ratchet\MessageComponentInterface;
use Ratchet\ConnectionInterface;
use Ratchet\Server\IoServer;
use Ratchet\Http\HttpServer;
use Ratchet\WebSocket\WsServer;

/**
 * WebSocketの接続やメッセージを処理するメインのクラス
 */
class JmaFetcher implements MessageComponentInterface {

    /** @var \SplObjectStorage 接続中の全クライアントを保管する場所 */
    protected $clients;
    
    /** @var string 最後に取得したデータのハッシュ値 */
    private $lastDataHash;

    /**
     * コンストラクタ：プロパティを初期化し、基準となる初回データを取得
     */
    public function __construct() {
        $this->clients = new \SplObjectStorage;
        echo "JMA Fetcherが初期化されました。\n";
        
        echo "初回データチェック（基準データを設定）...\n";
        try {
            $initialData = $this->fetchJmaData();
            $this->lastDataHash = md5(json_encode($initialData['data']));
            echo "初期ハッシュが設定されました: " . $this->lastDataHash . "\n";
        } catch (\Exception $e) {
            $this->lastDataHash = '';
            echo "初回データ取得時にエラー: " . $e->getMessage() . "\n";
        }
    }

    /**
     * 新しいクライアントが接続してきた時に呼ばれるメソッド
     */
    public function onOpen(ConnectionInterface $conn) {
        $this->clients->attach($conn);
        echo "新しいクライアントが接続しました！ ({$conn->resourceId}) 現在の接続数: " . count($this->clients) . "\n";
    }

    /**
     * クライアントからメッセージを受信した時に呼ばれるメソッド
     */
    public function onMessage(ConnectionInterface $from, $msg) {
        echo sprintf('クライアント %d からのメッセージ "%s"' . "\n", $from->resourceId, $msg);
    }

    /**
     * クライアントとの接続が切れた時に呼ばれるメソッド
     */
    public function onClose(ConnectionInterface $conn) {
        $this->clients->detach($conn);
        echo "クライアント ({$conn->resourceId}) との接続が切れました。現在の接続数: " . count($this->clients) . "\n";
    }

    /**
     * エラーが発生した時に呼ばれるメソッド
     */
    public function onError(ConnectionInterface $conn, \Exception $e) {
        echo "エラーが発生しました: {$e->getMessage()}\n";
        $conn->close();
    }

    /**
     * 【タイマー用】情報の更新をチェックし、変更があれば全クライアントに送信する
     */
    public function checkForUpdates() {
        echo date('Y-m-d H:i:s') . " - JMA情報の更新をチェック中...\n";
        
        $newData = $this->fetchJmaData();
        
        if (!empty($newData['errors'])) {
            echo "データ取得時に一部エラーがありました（これは正常な場合があります）:\n";
            foreach ($newData['errors'] as $id => $errorMessage) {
                echo "  - [情報] ${id}: ${errorMessage}\n";
            }
        }

        $newDataHash = md5(json_encode($newData['data']));

        if ($this->lastDataHash !== $newDataHash && !empty($newData['data'])) {
            echo "★★★ 更新を検知！接続中の " . count($this->clients) . " クライアントにブロードキャストします。 ★★★\n";
            
            $this->lastDataHash = $newDataHash;
            $payload = json_encode($newData, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
            
            foreach ($this->clients as $client) {
                $client->send($payload);
            }
        } else {
            echo "データに変更はありませんでした。\n";
        }
    }

    /**
     * JMAから防災情報を取得・解析する内部メソッド
     * @return array
     */
    private function fetchJmaData(): array
    {
        if (!defined('FEED_URL')) define('FEED_URL', 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml');
        if (!defined('TARGET_ID_PARTS')) define('TARGET_ID_PARTS', ['VXWW50', 'VPWW50']);

        $finalResults = [];
        $errors = [];

        foreach (TARGET_ID_PARTS as $idPart) {
            try {
                $targetXmlUrl = fetchLatestDataUrl(FEED_URL, $idPart);
                $xmlContent = fetchXmlContent($targetXmlUrl, $idPart);
                $parsedData = null;
                switch ($idPart) {
                    case 'VXWW50': $parsedData = parseLandslideInfoXml($xmlContent); break;
                    case 'VPWW50': $parsedData = parseFloodForecastXml($xmlContent); break;
                }
                if ($parsedData) {
                    $finalResults[$idPart] = $parsedData;
                }
            } catch (\Exception $e) {
                $errors[$idPart] = $e->getMessage();
            }
        }

        return ['data' => $finalResults, 'errors' => $errors];
    }
}


// ===== サーバーの起動処理 =====

$jmaFetcherApp = new JmaFetcher();

$server = IoServer::factory(
    new HttpServer(
        new WsServer($jmaFetcherApp)
    ),
    8080 // ポート番号
);

// 15秒ごとにcheckForUpdatesメソッドを実行するタイマーを追加
$server->loop->addPeriodicTimer(15, function() use ($jmaFetcherApp) {
    $jmaFetcherApp->checkForUpdates();
});

echo "🚀 WebSocketサーバーがポート 8080 で起動しました。(15秒ごとに更新チェック)\n";
echo "クライアントからの接続を待っています...\n";

// サーバーを永続的に実行
$server->run();