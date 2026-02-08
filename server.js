import express from "express";
import crypto from "crypto";

const app = express();

// 重要：LINE署名検証に raw body が必要なので、verify で保存する
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

const GAS_API_URL = process.env.GAS_API_URL; // 例: https://script.google.com/macros/s/xxx/exec
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;

// 動作確認用
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ ok: true }));

function isValidLineSignature(req) {
  if (!LINE_CHANNEL_SECRET) return false;
  const signature = req.header("x-line-signature");
  if (!signature) return false;

  const hash = crypto
    .createHmac("sha256", LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");

  return hash === signature;
}

async function forwardToGAS(payload) {
  if (!GAS_API_URL || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(GAS_API_URL)) {
    throw new Error(`GAS_API_URLが不正です: ${String(GAS_API_URL)}`);
  }

  const r = await fetch(GAS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const text = await r.text().catch(() => "");
  return { status: r.status, text };
}

async function replyToLine(replyToken, text) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) return;

  const url = "https://api.line.me/v2/bot/message/reply";
  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text: String(text) }],
    }),
  });
}

app.post("/webhook", async (req, res) => {
  try {
    // 署名検証（安全のためON推奨）
    const okSig = isValidLineSignature(req);
    if (!okSig) {
      console.log("LINE signature NG");
      return res.status(401).send("Bad signature");
    }

    console.log("LINE Webhook:", JSON.stringify(req.body, null, 2));

    // まずLINEへ即200（タイムアウト防止）
    res.status(200).send("OK");

    // その後バックでGASへ転送（Renderは同リクエスト内で非同期OK）
    const result = await forwardToGAS(req.body);
    console.log("Forwarded to GAS:", result.status, result.text?.slice(0, 200));

  } catch (err) {
    console.log("webhook error:", err?.message || err);
    // ここは既に200返してる可能性があるので何もしない
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
  console.log("GAS_API_URL:", GAS_API_URL ? "SET" : "NOT SET");
  console.log("LINE_CHANNEL_SECRET:", LINE_CHANNEL_SECRET ? "SET" : "NOT SET");
  console.log("LINE_CHANNEL_ACCESS_TOKEN:", LINE_CHANNEL_ACCESS_TOKEN ? "SET" : "NOT SET");
});
