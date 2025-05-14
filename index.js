require('dotenv').config();
const express = require('express');
const { Client, middleware } = require('@line/bot-sdk');
const mysql = require('mysql2/promise');

const config = {
  channelSecret: process.env.LINE_CHANNEL_SECRET,
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
};
// 建立 LINE client
const lineClient = new Client(config);
// 建立資料庫連線池
const db = mysql.createPool({
  host: process.env.MYSQL_HOST, // ← 這裡
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const app = express();
// 這個 middleware 會驗證 LINE 的 X-Line-Signature
app.post(
  '/callback',
  // 1. 保留原始 JSON buffer 給下面的 middleware 驗簽
  express.raw({ type: 'application/json' }),

  // 2. 印出簽章＆Secret，確認有打到這裡
  (req, res, next) => {
    console.log('👉 X-Line-Signature:', req.headers['x-line-signature']);
    console.log('👉 Local Channel Secret:', process.env.LINE_CHANNEL_SECRET);
    next();
  },

  // 3. LINE SDK 驗簽 middleware，不通過會自動回 400
  middleware(config),

  // 4. 真正的 handler，一定要先回 200
  async (req, res) => {
    res.status(200).end();
    try {
      // 處理每一個 event
      await Promise.all(req.body.events.map(handleEvent));
    } catch (err) {
      console.error(err);
    }
  }
);

// 處理單一事件的函式
async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    // 只處理文字訊息
    return;
  }

  const text = event.message.text;
  const ts = new Date();

  try {
    // 1. 在資料庫中比對
    const [rows] = await db.execute(
      'SELECT serialID FROM NewTable WHERE serialID = ? LIMIT 1',
      [text]
    );

    let reply = '謝謝你的訊息，我們已經收到！';
    if (rows.length < 1) {
      // 2. 將訊息存入資料庫
      await db.execute('INSERT INTO NewTable (serialID,Time) VALUES (?,?)', [
        text,
        ts,
      ]);
      // reply = rows[0].serialID;
    } else {
      const [Time] = await db.execute(
        'SELECT Time FROM NewTable WHERE serialID = ? LIMIT 1',
        [text]
      );
      console.log(Time);

      reply = `已在${Time[0].Time}登錄`;
    }

    // 3. 回覆使用者
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: reply,
    });
  } catch (err) {
    console.error('🔥 handleEvent 發生錯誤：', err);
    return lineClient.replyMessage(event.replyToken, {
      type: 'text',
      text: 504,
    });
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
