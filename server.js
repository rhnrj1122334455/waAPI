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

// Connection retry settings
const RECONNECT_DELAY = 5000; // 5 seconds
const MAX_RETRIES = 5;
const retryCounters = new Map();

// Create sessions directory if it doesn't exist
const SESSIONS_DIR = path.join(__dirname, "sessions");
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Clear existing session
function clearSession(userId) {
    const sessionDir = path.join(SESSIONS_DIR, userId);
    if (fs.existsSync(sessionDir)) {
        try {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log(`Session directory for ${userId} cleared`);
            return true;
        } catch (error) {
            console.error(`Failed to clear session for ${userId}:`, error);
            return false;
        }
    }
    return true; // No session to clear
}

// Create a new WhatsApp session for a user
async function createSession(userId, clearExistingSession = false) {
    // Initialize retry counter if needed
    if (!retryCounters.has(userId)) {
        retryCounters.set(userId, 0);
    }

    // If session exists, delete it
    if (clients.has(userId)) {
        const existingClient = clients.get(userId);
        existingClient.sock.end();
        clients.delete(userId);
        console.log(`Previous session for ${userId} closed`);
    }

    // Clear existing session files if requested
    if (clearExistingSession) {
        clearSession(userId);
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
        lastError: null,
    };

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        connectTimeoutMs: 60000,
        qrTimeout: 60000,
        retryRequestDelayMs: 2000,
        browser: ["WhatsApp API", "Chrome", "1.0.0"],
        version: [2, 2323, 4],
    });

    client.sock = sock;
    clients.set(userId, client);

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            // Reset retry counter on new QR code
            retryCounters.set(userId, 0);
            
            // Generate QR code as base64 image
            client.qr = await qrcode.toDataURL(qr);
            console.log(`QR Code generated for ${userId}`);
        }

        if (connection === "open") {
            client.isConnected = true;
            client.qr = null;
            client.lastError = null;
            retryCounters.set(userId, 0); // Reset retry counter on successful connection
            console.log(`✅ ${userId} connected to WhatsApp!`);
        }

        if (connection === "close") {
            client.isConnected = false;
            
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const reason = lastDisconnect?.error?.message || "Unknown error";
            const logoutCode = DisconnectReason.loggedOut;
            
            console.log(`❌ Connection closed for ${userId}. Status: ${statusCode}, Reason: ${reason}`);
            
            client.lastError = {
                statusCode,
                reason,
                timestamp: new Date().toISOString()
            };

            const shouldReconnect = statusCode !== logoutCode;
            const currentRetries = retryCounters.get(userId);
            
            if (shouldReconnect && currentRetries < MAX_RETRIES) {
                console.log(`Reconnecting ${userId} in ${RECONNECT_DELAY}ms (attempt ${currentRetries + 1}/${MAX_RETRIES})`);
                retryCounters.set(userId, currentRetries + 1);
                
                setTimeout(() => {
                    // If we've had multiple failures, try clearing the session
                    const shouldClearSession = currentRetries >= 3;
                    createSession(userId, shouldClearSession);
                }, RECONNECT_DELAY);
            } else {
                if (currentRetries >= MAX_RETRIES) {
                    console.log(`Max retries (${MAX_RETRIES}) reached for ${userId}. Giving up.`);
                } else {
                    console.log(`User ${userId} logged out`);
                }
                
                clients.delete(userId);
            }
        }
    });

    return client;
}

// API Endpoints
app.get("/login/:userId", async (req, res) => {
    const { userId } = req.params;
    const { reset } = req.query;

    try {
        let client;
        if (reset === "true" || !clients.has(userId)) {
            client = await createSession(userId, reset === "true");
        } else {
            client = clients.get(userId);
        }

        if (client.isConnected) {
            res.json({ success: true, status: "connected" });
        } else {
            res.json({ 
                success: true, 
                status: "pending", 
                qr: client.qr,
                lastError: client.lastError
            });
        }
    } catch (error) {
        console.error(`Error creating session for ${userId}:`, error);
        res.status(500).json({
            success: false,
            error: "Failed to create session",
            details: error.message
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
            details: error.message
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
        lastError: client.lastError,
        retryCount: retryCounters.get(userId) || 0
    });
});

// Logout endpoint
app.post("/logout/:userId", (req, res) => {
    const { userId } = req.params;

    if (clients.has(userId)) {
        const client = clients.get(userId);
        client.sock.end();
        clients.delete(userId);
        retryCounters.delete(userId);

        // Remove session files
        clearSession(userId);

        console.log(`User ${userId} logged out`);
        res.json({ success: true, message: "Logged out successfully" });
    } else {
        res.json({ success: true, message: "No active session" });
    }
});

// Force reset endpoint
app.post("/reset/:userId", (req, res) => {
    const { userId } = req.params;
    
    try {
        // Clear session data
        clearSession(userId);
        
        // Close existing connection if any
        if (clients.has(userId)) {
            const client = clients.get(userId);
            client.sock.end();
            clients.delete(userId);
        }
        
        // Reset retry counter
        retryCounters.delete(userId);
        
        res.json({ success: true, message: "Session reset successfully" });
    } catch (error) {
        console.error(`Error resetting session for ${userId}:`, error);
        res.status(500).json({
            success: false,
            error: "Failed to reset session",
            details: error.message
        });
    }
});

// Health check endpoint
app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "running",
        activeSessions: clients.size,
        uptime: process.uptime()
    });
});

// Handle process termination gracefully
process.on("SIGTERM", () => {
    console.log("Received SIGTERM. Cleaning up...");
    // Close all connections
    for (const [userId, client] of clients.entries()) {
        if (client.sock) {
            client.sock.end();
            console.log(`Closed connection for ${userId}`);
        }
    }
    process.exit(0);
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    // Keep process alive but log the error
});

process.on("unhandledRejection", (err) => {
    console.error("Unhandled Rejection:", err);
    // Keep process alive but log the error
});

// Start Express server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 API Server running on port ${PORT}`);
});
