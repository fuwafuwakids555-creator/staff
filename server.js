import express from "express";

const app = express();
app.use(express.json());

app.post("/webhook", (req, res) => {
  console.log("LINE Webhook:", JSON.stringify(req.body, null, 2));

  // イベントがあれば中身を表示
  if (req.body.events && req.body.events.length > 0) {
    const event = req.body.events[0];

    if (event.type === "message" && event.message.type === "text") {
      const userMessage = event.message.text;
      console.log("ユーザーの発言:", userMessage);
    }
  }

  res.status(200).send("OK");
});

const PORT = process.env.PORT || 10000; // Renderは10000番
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
