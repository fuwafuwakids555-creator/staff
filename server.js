import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// Render の Environment Variables に設定する
// LINE_CHANNEL_ACCESS_TOKEN : LINEのチャネルアクセストークン（再発行したやつ）
// GAS_API_URL              : https://script.google.com/macros/s/xxxxx/exec
// RENDER_SECRET            : GASとRenderで同じ合言葉（長い文字列）

const LINE_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const GAS_API_URL = process.env.GAS_API_URL;
const RENDER_SECRET = process.env.RENDER_SECRET;

function mustEnv(name, v) {
  if (!v) {
    console.error(`[ENV MISSING] ${name} is not set`);
  }
}
mustEnv("LINE_CHANNEL_ACCESS_TOKEN", LINE_TOKEN);
mustEnv("GAS_API_URL", GAS_API_URL);
mustEnv("RENDER_SECRET", RENDER_SECRET);

// ---- LINE API ----
async function replyLine(replyToken, text) {
  if (!replyToken) return;
  const url = "https://api.line.me/v2/bot/message/reply";
  const payload = {
    replyToken,
    messages: [{ type: "text", text: String(text) }],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LINE_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error("replyLine failed", res.status, await res.text());
  }
}

async function getProfile(userId) {
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bearer ${LINE_TOKEN}` },
    });
    if (!res.ok) return {};
    return await res.json();
  } catch (e) {
    return {};
  }
}

// ---- GAS 呼び出し ----
async function callGas(payload) {
  const res = await fetch(GAS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret: RENDER_SECRET }),
  });
  const text = await res.text();
  return { status: res.status, text };
}

// userId から staffId を引く（GAS側 whoami）
async function whoami(userId) {
  const r = await callGas({ action: "whoami", userId });
  if (r.status !== 200) return "";
  // GASは staffId だけ返す仕様（未登録なら空）
  return String(r.text || "").trim();
}

app.get("/", (req, res) => res.status(200).send("OK"));

app.post("/webhook", async (req, res) => {
  // LINE側に再送されないために、どんな場合でも200を返す
  try {
    const body = req.body;
    console.log("LINE Webhook:", JSON.stringify(body));

    if (!body || !body.events || body.events.length === 0) {
      return res.status(200).send("OK");
    }

    for (const ev of body.events) {
      // 友だち追加
      if (ev.type === "follow") {
        await replyLine(ev.replyToken, "登録のため、3桁のスタッフコード（例：001）を送ってください。");
        continue;
      }

      // テキスト以外は無視
      if (ev.type !== "message" || !ev.message || ev.message.type !== "text") continue;

      const userId = ev.source?.userId;
      const text = String(ev.message.text || "").trim();
      if (!userId) continue;

      // プロフィール名（取れなくてもOK）
      const profile = await getProfile(userId);
      const lineName = profile.displayName || "";

      // ① まだ紐付けが無いなら、まず staffId を探す
      let staffId = await whoami(userId);

      // ② 紐付け前：3桁コードならリンク
      if (!staffId) {
        if (/^\d{3}$/.test(text)) {
          const r = await callGas({
            action: "link",
            staffId: text,
            userId,
            lineName,
          });

          if (String(r.text).includes("OK")) {
            await replyLine(
              ev.replyToken,
              `スタッフコード「${text}」で登録しました。\n今後このLINEで個別連絡します。\nメッセージを送ると管理者に届きます。`
            );
          } else {
            await replyLine(
              ev.replyToken,
              `スタッフコード「${text}」が見つかりませんでした。\nもう一度3桁コードを送ってください。`
            );
          }
          continue;
        } else {
          await replyLine(ev.replyToken, "最初に3桁のスタッフコード（例：001）を送ってください。");
          continue;
        }
      }

      // ③ 紐付け済み：チャットとしてGASへ保存
      const chatRes = await callGas({
        action: "chat",
        staffId,
        senderName: lineName || "スタッフ",
        message: text,
      });

      if (!String(chatRes.text).includes("OK")) {
        console.error("chat save failed", chatRes.status, chatRes.text);
      }

      await replyLine(ev.replyToken, "受け付けました！管理者が確認します。");
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("webhook error", err);
    return res.status(200).send("OK");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port", PORT));
