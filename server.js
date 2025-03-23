const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

let sock; // Declare the socket globally

async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
            if (connection === "open") {
                console.log("✅ Connected to WhatsApp!");
            } else if (connection === "close") {
                console.log("❌ Disconnected. Reconnecting...");
                await delay(5000); // Wait 5 seconds before reconnecting
                startBot(); // Restart the bot
            } else {
                console.log(`⚠️ Connection status: ${connection}`);
            }
        });

    } catch (error) {
        console.error("❌ Failed to start bot:", error);
    }
}

// API Endpoint to send messages
app.post("/send-message", async (req, res) => {
    const { number, message } = req.body;

    if (!number || !message) {
        return res.status(400).json({
            success: false,
            error: "Missing number or message",
        });
    }

    if (!sock) {
        return res.status(500).json({
            success: false,
            error: "WhatsApp bot is not connected yet. Try again later.",
        });
    }

    const formattedNumber = number.includes("@s.whatsapp.net")
        ? number
        : number + "@s.whatsapp.net";

    try {
        console.log(`📩 Sending message to: ${formattedNumber}`);

        await sock.sendMessage(formattedNumber, { text: message });

        console.log(`✅ Message successfully sent to ${formattedNumber}`);
        res.json({ success: true, message: "Message sent successfully" });

    } catch (error) {
        console.error(`❌ Failed to send message: ${error.message}`);
        res.status(500).json({
            success: false,
            error: error.message || "Failed to send message",
        });
    }
});

// Start the bot and the API server
startBot();

app.listen(PORT, () => {
    console.log(`🚀 API Server running on http://localhost:${PORT}`);
});
