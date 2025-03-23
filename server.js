const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const {
    default: makeWASocket,
    useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = 3000; // Change if needed

app.use(cors());
app.use(bodyParser.json());

async function startBot() {
    const { state, saveCreds } =
        await useMultiFileAuthState("auth_info_baileys");

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection }) => {
        if (connection === "open") {
            console.log("✅ Connected to WhatsApp!");
        }
    });

    // API Endpoint to send messages
    app.post("/send-message", async (req, res) => {
        const { number, message } = req.body;

        if (!number || !message) {
            return res
                .status(400)
                .json({ success: false, error: "Missing number or message" });
        }

        const formattedNumber = number.includes("@s.whatsapp.net")
            ? number
            : number + "@s.whatsapp.net";

        try {
            await sock.sendMessage(formattedNumber, { text: message });
            console.log(`✅ Message sent to ${formattedNumber}: ${message}`);
            res.json({ success: true, message: "Message sent successfully" });
        } catch (error) {
            console.error(`❌ Failed to send message:`, error);
            res.status(500).json({
                success: false,
                error: "Failed to send message",
            });
        }
    });

    // Start Express server
    app.listen(PORT, () => {
        console.log(`🚀 API Server running on http://localhost:${PORT}`);
    });
}

startBot();
