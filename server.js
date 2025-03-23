const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const makeWASocket = require("@whiskeysockets/baileys").default;
const { useMongoDBAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const mongoose = require("mongoose");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || "your_mongodb_connection_string"; // Add this in Railway environment variables

app.use(cors());
app.use(bodyParser.json());

// Connect to MongoDB
mongoose
    .connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
    .then(() => console.log("✅ Connected to MongoDB"))
    .catch((err) => console.error("❌ MongoDB Connection Error:", err));

let sock;

async function startBot() {
    const { state, saveCreds } = await useMongoDBAuthState(MONGO_URI);

    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === "open") {
            console.log("✅ Connected to WhatsApp!");
        } else if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            console.log("❌ Disconnected. Reconnecting...");
            if (shouldReconnect) {
                setTimeout(startBot, 5000);
            } else {
                console.log("🚨 Session expired. Scan QR code again.");
            }
        } else {
            console.log(`⚠️ Connection status: ${connection}`);
        }
    });

    sock.ev.on("messages.upsert", async (message) => {
        console.log("📩 New message received:", JSON.stringify(message, null, 2));
    });
}

// API Endpoint to send messages
app.post("/send-message", async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ success: false, error: "Missing number or message" });
    }

    const formattedNumber = number.includes("@s.whatsapp.net")
        ? number
        : number + "@s.whatsapp.net";

    try {
        const result = await sock.sendMessage(formattedNumber, { text: message });
        console.log(`✅ Message sent to ${formattedNumber}: ${message}`);
        res.json({ success: true, message: "Message sent successfully", result });
    } catch (error) {
        console.error("❌ Failed to send message:", error);
        res.status(500).json({ success: false, error: error.toString() });
    }
});

// Start Express server
app.listen(PORT, () => {
    console.log(`🚀 API Server running on http://localhost:${PORT}`);
});

startBot();
