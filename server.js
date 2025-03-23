const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000; // Use Railway's port or default to 3000

app.use(cors());
app.use(bodyParser.json());

let sock;

async function startBot() {
    console.log("🚀 Starting WhatsApp bot...");

    try {
        const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
        
        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
            if (connection === "open") {
                console.log("✅ Connected to WhatsApp!");
            } else if (connection === "close") {
                const reason = lastDisconnect?.error?.output?.statusCode;
                console.log("❌ Disconnected. Reason:", reason);

                if (reason !== DisconnectReason.loggedOut) {
                    console.log("🔄 Reconnecting...");
                    startBot(); // Reconnect
                } else {
                    console.log("⚠️ Logged out. Scan the QR code again.");
                }
            }
        });

        sock.ev.on("messages.upsert", (m) => {
            console.log("📩 Received message:", JSON.stringify(m, null, 2));
        });

    } catch (error) {
        console.error("❌ Error starting bot:", error);
    }
}

app.post("/send-message", async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({ success: false, error: "Missing number or message" });
    }

    const formattedNumber = number.includes("@s.whatsapp.net") ? number : number + "@s.whatsapp.net";

    if (!sock) {
        return res.status(500).json({ success: false, error: "WhatsApp is not connected" });
    }

    try {
        const sentMessage = await sock.sendMessage(formattedNumber, { text: message });
        console.log(`✅ Message sent to ${formattedNumber}: ${message}`);
        res.json({ success: true, message: "Message sent successfully", id: sentMessage.key.id });
    } catch (error) {
        console.error(`❌ Failed to send message:`, error);
        res.status(500).json({ success: false, error: "Failed to send message" });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 API Server running on port ${PORT}`);
    startBot(); // Start bot on server start
});
