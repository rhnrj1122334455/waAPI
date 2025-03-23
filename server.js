const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto"); // ✅ Fix for "crypto is not defined"
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason
} = require("@whiskeysockets/baileys");

// Delete old authentication folder
const authFolder = path.join(__dirname, "auth_info_baileys");
if (fs.existsSync(authFolder)) {
    fs.rmSync(authFolder, { recursive: true, force: true });
    console.log("✅ Deleted old auth_info_baileys folder.");
}

// Initialize Express
const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(bodyParser.json());

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
            if (connection === "open") {
                console.log("✅ Connected to WhatsApp!");
            } else if (connection === "close") {
                const reason = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.message;
                console.log(`❌ Disconnected. Reason: ${reason}`);

                if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                    console.log("🔄 Reconnecting...");
                    startBot(); // Restart bot
                } else {
                    console.log("🚨 Logged out. Manual restart required.");
                }
            }
        });

        app.post("/send-message", async (req, res) => {
            const { number, message } = req.body;

            if (!number || !message) {
                return res.status(400).json({ success: false, error: "Missing number or message" });
            }

            const formattedNumber = number.includes("@s.whatsapp.net") ? number : number + "@s.whatsapp.net";

            try {
                const response = await sock.sendMessage(formattedNumber, { text: message });
                console.log(`✅ Message sent to ${formattedNumber}: ${message}`);
                res.json({ success: true, message: "Message sent successfully", response });
            } catch (error) {
                console.error("❌ Failed to send message:", error);
                res.status(500).json({ success: false, error: error.message });
            }
        });

        // Start Express server
        if (!module.parent) {
            app.listen(PORT, () => {
                console.log(`🚀 API Server running on http://localhost:${PORT}`);
            });
        }
    } catch (error) {
        console.error("🔥 Error starting bot:", error);
    }
}

// Start bot
startBot();
