import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();

// LINE署名検証用：生のBodyが必要
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

const GAS_API_URL = process.env.GAS_API_URL;               // ←ここが undefined だと落ちる
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;

function requireEnv(name, val) {
  if (!val || String(val).trim() === "") {
    throw new Error(`Missing env: ${name}`);
  }
  return String(val).trim();
}

function validateUrl(name, url) {
  try {
    new URL(url);
    return url;
  } catch {
    throw new Error(`Invalid URL in env ${name}: ${url}`);
  }
}

// 起動時にチェック（ここで原因が即わかる）
const GAS_URL = validateUrl("GAS_API_URL", requireEnv("GAS_API_URL", GAS_API_URL));
requireEnv("LINE_CHANNEL_SECRET", LINE_CHANNEL_SECRET);

function verifyLineSignature(req) {
  const signature = req.get("x-line-signature");
  if (!signature) return false;

  const hash = crypto
    .createHmac("SHA256", LINE_CHANNEL_SECRET)
    .update(req.rawBody)
    .digest("base64");

  return hash === signature;
}

app.get("/", (req, res) => {
  res.status(200).send("OK");
});

app.post("/webhook", async (req, res) => {
  try {
    // 署名チェック（LINEからの本物だけ通す）
    if (!verifyLineSignature(req)) {
      return res.status(401).send("Invalid signature");
    }

    console.log("LINE Webhook:", JSON.stringify(req.body, null, 2));

    // events が空のことは普通にある（検証ボタン等）
    const events = req.body?.events || [];
    if (events.length === 0) {
      return res.status(200).send("OK");
    }

    // GASへ丸投げ（GAS側 doPost が受ける）
    const r = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });

    const text = await r.text();
    console.log("GAS response:", r.status, text);

    return res.status(200).send("OK");
  } catch (err) {
    console.error("webhook error:", err);
    return res.status(200).send("OK"); // LINEには200返し（再送爆発防止）
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
