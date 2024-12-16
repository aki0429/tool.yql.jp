const express = require('express');
const mongoose = require('mongoose');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDBの接続
mongoose.connect('mongodb://localhost:27017/amedas', {
    useNewUrlParser: true,
    useUnifiedTopology: true
});

// スキーマの定義
const amedasSchema = new mongoose.Schema({
    date: { type: String, required: true },
    data: { type: Object, required: true },
    createdAt: { type: Date, default: Date.now, expires: '2d' } // 2日後に自動削除
});

// モデルの作成
const AmedasData = mongoose.model('AmedasData', amedasSchema);

// Middleware
app.use(bodyParser.json());

// データを保存するエンドポイント
app.post('/api/amedas', async (req, res) => {
    try {
        const { date, data } = req.body;
        const amedasData = new AmedasData({ date, data });
        await amedasData.save();
        res.status(201).send(amedasData);
    } catch (error) {
        res.status(400).send(error);
    }
});

// データを取得するエンドポイント
app.get('/api/amedas/:date', async (req, res) => {
    try {
        const { date } = req.params;
        const data = await AmedasData.findOne({ date });
        if (!data) {
            return res.status(404).send('データが見つかりません');
        }
        res.send(data);
    } catch (error) {
        res.status(500).send(error);
    }
});

// サーバーの起動
app.listen(PORT, () => {
    console.log(`サーバーがポート${PORT}で起動しました`);
});