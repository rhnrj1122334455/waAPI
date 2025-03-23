const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000; // Change port if needed
const AUTH_FOLDER = "auth_info_baileys";

// ✅ Delete old authentication folder if it exists
if (fs.existsSync(AUTH_FOLDER)) {
    fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
    console.log("✅ Deleted old auth_info_baileys folder.");
}

app.use(cors());
app.use(bodyParser.json());

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
        const { version } = await fetchLatestBaileysVersion();
        
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: true,
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
            if (connection === "open") {
                console.log("✅ Connected to WhatsApp!");
            } else if (connection === "close") {
                console.log("❌ Disconnected. Reconnecting...");
                setTimeout(startBot, 5000); // Retry connection after 5s
            }
        });

        sock.ev.on("messages.upsert", async (msg) => {
            console.log("📩 New Message:", msg);
        });

        // ✅ API Endpoint to Send Messages
        app.post("/send-message", async (req, res) => {
            const { number, message } = req.body;

            if (!number || !message) {
                return res.status(400).json({ success: false, error: "Missing number or message" });
            }

            const formattedNumber = number.includes("@s.whatsapp.net") ? number : number + "@s.whatsapp.net";

            try {
                await sock.sendMessage(formattedNumber, { text: message });
                console.log(`✅ Message sent to ${formattedNumber}: ${message}`);
                res.json({ success: true, message: "Message sent successfully" });
            } catch (error) {
                console.error(`❌ Failed to send message:`, error);
                res.status(500).json({ success: false, error: "Failed to send message" });
            }
        });

        // ✅ Start Express Server
        app.listen(PORT, () => {
            console.log(`🚀 API Server running on http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error("❌ Error starting bot:", error);
        setTimeout(startBot, 5000); // Retry connection after 5s if error occurs
    }
}

// Start the bot
startBot();
