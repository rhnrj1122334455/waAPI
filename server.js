const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode");

const app = express();
const PORT = 3000; // Change if needed

app.use(cors());
app.use(bodyParser.json());

// Store client sessions
const clients = new Map();

// Create sessions directory if it doesn't exist
const SESSIONS_DIR = path.join(__dirname, "sessions");
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Create a new WhatsApp session for a user
async function createSession(userId) {
    if (clients.has(userId)) {
        const existingClient = clients.get(userId);
        existingClient.sock.end();
        clients.delete(userId);
        console.log(`Previous session for ${userId} closed`);
    }

    const sessionDir = path.join(SESSIONS_DIR, userId);
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const client = {
        sock: null,
        qr: null,
        isConnected: false,
        timeout: null, // Store timeout reference
    };

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    client.sock = sock;
    clients.set(userId, client);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            client.qr = await qrcode.toDataURL(qr);
            console.log(`QR Code generated for ${userId}`);

            // Start a 30-second timeout
            client.timeout = setTimeout(() => {
                if (!client.isConnected) {
                    console.log(`❌ QR not scanned within 30s. Closing session for ${userId}`);
                    sock.end();
                    clients.delete(userId);

                    // Remove session files
                    if (fs.existsSync(sessionDir)) {
                        fs.rmSync(sessionDir, { recursive: true, force: true });
                    }
                }
            }, 30000);
        }

        if (connection === "open") {
            client.isConnected = true;
            client.qr = null;
            console.log(`✅ ${userId} connected to WhatsApp!`);

            // Clear the timeout since the user is now connected
            if (client.timeout) {
                clearTimeout(client.timeout);
                client.timeout = null;
            }
        }

        if (connection === "close") {
            const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !==
                DisconnectReason.loggedOut;
            console.log(`❌ Connection closed for ${userId}. Reconnect: ${shouldReconnect}`);

            if (shouldReconnect) {
                createSession(userId);
            } else {
                clients.delete(userId);
                console.log(`Session for ${userId} removed due to logout`);
            }
        }
    });

    return client;
}

            if (shouldReconnect) {
                createSession(userId);
            } else {
                clients.delete(userId);
                console.log(`Session for ${userId} removed due to logout`);
            }
        }
    });

    return client;
}

// API Endpoints
app.get("/login/:userId", async (req, res) => {
    const { userId } = req.params;

    try {
        const client = clients.has(userId)
            ? clients.get(userId)
            : await createSession(userId);

        if (client.isConnected) {
            res.json({ success: true, status: "connected" });
        } else {
            res.json({ success: true, status: "pending", qr: client.qr });
        }
    } catch (error) {
        console.error(`Error creating session for ${userId}:`, error);
        res.status(500).json({
            success: false,
            error: "Failed to create session",
        });
    }
});

app.post("/send-message", async (req, res) => {
    const { userId, number, message } = req.body;

    if (!userId || !number || !message) {
        return res.status(400).json({
            success: false,
            error: "Missing userId, number or message",
        });
    }

    const client = clients.get(userId);
    if (!client || !client.isConnected) {
        return res.status(401).json({
            success: false,
            error: "WhatsApp not connected for this user",
        });
    }

    const formattedNumber = number.includes("@s.whatsapp.net")
        ? number
        : number + "@s.whatsapp.net";

    try {
        await client.sock.sendMessage(formattedNumber, { text: message });
        console.log(
            `✅ Message sent to ${formattedNumber} by ${userId}: ${message}`,
        );
        res.json({ success: true, message: "Message sent successfully" });
    } catch (error) {
        console.error(`❌ Failed to send message:`, error);
        res.status(500).json({
            success: false,
            error: "Failed to send message",
        });
    }
});

// Check connection status
app.get("/status/:userId", (req, res) => {
    const { userId } = req.params;
    const client = clients.get(userId);

    if (!client) {
        return res.json({ success: true, status: "disconnected" });
    }

    res.json({
        success: true,
        status: client.isConnected ? "connected" : "pending",
        qr: client.qr,
    });
});

// Logout endpoint
app.post("/logout/:userId", (req, res) => {
    const { userId } = req.params;

    if (clients.has(userId)) {
        const client = clients.get(userId);
        client.sock.end();
        clients.delete(userId);

        // Optionally remove session files
        const sessionDir = path.join(SESSIONS_DIR, userId);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }

        console.log(`User ${userId} logged out`);
        res.json({ success: true, message: "Logged out successfully" });
    } else {
        res.json({ success: true, message: "No active session" });
    }
});

// Handle process termination gracefully
process.on("SIGTERM", () => {
    console.log("Received SIGTERM. Cleaning up...");
    // Add cleanup code here if needed
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    // Keep process alive
});

process.on("unhandledRejection", (err) => {
    console.error("Unhandled Rejection:", err);
    // Keep process alive
});

// Start Express server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 API Server running on port ${PORT}`);
});
