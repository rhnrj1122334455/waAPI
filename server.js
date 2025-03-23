const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// 🔹 Delete auth folder if it exists (Prevents corrupted sessions)
const authFolder = "auth_info_baileys";
if (fs.existsSync(authFolder)) {
    fs.rmSync(authFolder, { recursive: true, force: true });
    console.log("🗑️ Deleted old auth_info_baileys folder.");
}

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
        });

        sock.ev.on("creds.update", saveCreds);

        // 🔹 Handle connection updates
        sock.ev.on("connection.update", (update) => {
            const { connection, lastDisconnect } = update;
            console.log("🔹 Connection Update:", update);

            if (connection === "open") {
                console.log("✅ Connected to WhatsApp!");
            } else if (connection === "close") {
                const reason = lastDisconnect?.error?.output?.statusCode;
                console.log("❌ Disconnected. Reason:", reason);

                if (reason !== DisconnectReason.loggedOut) {
                    console.log("🔄 Reconnecting...");
                    startBot();
                } else {
                    console.log("⚠️ Logged out. Scan QR again.");
                }
            }
        });

        // 🔹 API Endpoint to send messages
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

        // 🔹 Start Express server
        app.listen(PORT, () => {
            console.log(`🚀 API Server running on http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error("🔥 Fatal Error:", error);
        console.log("🔄 Restarting bot...");
        setTimeout(startBot, 5000);
    }
}

startBot();
