// 電力供給データを取得して表示する関数
async function fetchElectricityData() {
    try {
        // プロキシサーバーのURL
        const proxyUrl = 'http://localhost/electricity/proxy.php?url='; // proxy.phpのパスを指定
        const targetUrl = "https://www.tepco.co.jp/forecast/html/images/juyo-s1-j.csv";
        
        // プロキシを経由してデータを取得
        const response = await fetch(proxyUrl + encodeURIComponent(targetUrl));
        const data = await response.text();
        
        // CSVデータを解析
        const parsedData = Papa.parse(data, { header: true }).data;

        // データを表示するためのテーブルを作成
        const table = document.createElement('table');
        const headerRow = document.createElement('tr');
        
        // テーブルヘッダーを作成
        Object.keys(parsedData[0]).forEach(key => {
            const th = document.createElement('th');
            th.textContent = key;
            headerRow.appendChild(th);
        });
        table.appendChild(headerRow);

        // テーブル行を作成
        parsedData.forEach(row => {
            const tr = document.createElement('tr');
            Object.values(row).forEach(value => {
                const td = document.createElement('td');
                td.textContent = value;
                tr.appendChild(td);
            });
            table.appendChild(tr);
        });

        // テーブルをボディまたは特定のdivに追加
        document.getElementById('data-table').appendChild(table);
    } catch (error) {
        console.error("電力データの取得中にエラーが発生しました:", error);
    }
}

// データを取得して表示する関数を呼び出す
fetchElectricityData();