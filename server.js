const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const fs = require("fs");
const path = require("path");
const qrcode = require("qrcode");
const pino = require("pino");

// Create Express server
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware setup
app.use(cors());
app.use(bodyParser.json());

// Setup minimal logger to reduce noise
const logger = pino({ 
    level: 'error', // Only log errors
});

// Store active client sessions
const clients = {};

// Create sessions directory if it doesn't exist
const SESSIONS_DIR = path.join(__dirname, "sessions");
if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Clear session directory for a user
function clearSession(userId) {
    try {
        const sessionDir = path.join(SESSIONS_DIR, userId);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
            console.log(`Session for ${userId} cleared`);
        }
        return true;
    } catch (error) {
        console.error(`Failed to clear session for ${userId}:`, error);
        return false;
    }
}

// Create or get existing WhatsApp session
async function getSession(userId, reset = false) {
    // Close existing session if any
    if (clients[userId] && clients[userId].sock) {
        try {
            clients[userId].sock.end();
            console.log(`Closed existing session for ${userId}`);
        } catch (err) {
            console.error(`Error closing session for ${userId}:`, err);
        }
        delete clients[userId];
    }

    // Clear session files if reset requested
    if (reset) {
        clearSession(userId);
    }

    try {
        // Ensure session directory exists
        const sessionDir = path.join(SESSIONS_DIR, userId);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Get auth state
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        
        // Get baileys version
        const { version } = await fetchLatestBaileysVersion();
        
        // Create new client record
        clients[userId] = {
            sock: null,
            qr: null,
            isConnected: false,
            error: null
        };

        // Create WhatsApp connection
        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: true,
            logger: logger,
            browser: ["WhatsApp API", "Chrome", "1.0.0"],
            connectTimeoutMs: 60000,
        });

        // Save socket reference
        clients[userId].sock = sock;

        // Handle credential updates
        sock.ev.on("creds.update", saveCreds);

        // Handle connection state changes
        sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect, qr } = update;

            // Generate QR code if needed
            if (qr) {
                try {
                    clients[userId].qr = await qrcode.toDataURL(qr);
                    console.log(`QR code generated for ${userId}`);
                } catch (err) {
                    console.error(`QR generation error:`, err);
                }
            }

            // Handle successful connection
            if (connection === "open") {
                clients[userId].isConnected = true;
                clients[userId].qr = null;
                clients[userId].error = null;
                console.log(`✅ ${userId} connected!`);
            }

            // Handle disconnection
            if (connection === "close") {
                clients[userId].isConnected = false;
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const logoutCode = DisconnectReason.loggedOut;
                
                // Check if user logged out or connection failed
                if (statusCode === logoutCode) {
                    console.log(`User ${userId} logged out`);
                    delete clients[userId];
                    clearSession(userId);
                } else {
                    clients[userId].error = {
                        message: lastDisconnect?.error?.message || "Unknown error",
                        time: new Date().toISOString()
                    };
                }
            }
        });

        return clients[userId];
    } catch (error) {
        console.error(`Session creation error for ${userId}:`, error);
        throw error;
    }
}

// API Endpoints

// Login/initialize session
app.get("/login/:userId", async (req, res) => {
    try {
        const { userId } = req.params;
        const { reset } = req.query;
        const shouldReset = reset === "true";
        
        const client = await getSession(userId, shouldReset);
        
        if (client.isConnected) {
            res.json({ success: true, status: "connected" });
        } else {
            res.json({ 
                success: true, 
                status: "pending", 
                qr: client.qr,
                error: client.error
            });
        }
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({
            success: false,
            error: "Login failed",
            details: error.message
        });
    }
});

// Check session status
app.get("/status/:userId", (req, res) => {
    const { userId } = req.params;
    const client = clients[userId];
    
    if (!client) {
        return res.json({ 
            success: true, 
            status: "disconnected" 
        });
    }
    
    res.json({
        success: true,
        status: client.isConnected ? "connected" : "pending",
        qr: client.qr,
        error: client.error
    });
});

// Send message
app.post("/send-message", async (req, res) => {
    try {
        const { userId, number, message } = req.body;
        
        // Validate input
        if (!userId || !number || !message) {
            return res.status(400).json({
                success: false,
                error: "Missing userId, number or message",
            });
        }
        
        // Check client connection
        const client = clients[userId];
        if (!client || !client.isConnected) {
            return res.status(401).json({
                success: false,
                error: "WhatsApp not connected",
            });
        }
        
        // Format phone number
        const cleanNumber = number.replace(/\D/g, "");
        const formattedNumber = number.includes("@s.whatsapp.net")
            ? number
            : `${cleanNumber}@s.whatsapp.net`;
        
        // Send message
        await client.sock.sendMessage(formattedNumber, { text: message });
        console.log(`✅ Message sent to ${cleanNumber} by ${userId}`);
        
        res.json({ 
            success: true, 
            message: "Message sent successfully" 
        });
    } catch (error) {
        console.error("Send message error:", error);
        res.status(500).json({
            success: false,
            error: "Failed to send message",
            details: error.message
        });
    }
});

// Logout
app.post("/logout/:userId", (req, res) => {
    const { userId } = req.params;
    
    if (clients[userId]) {
        if (clients[userId].sock) {
            try {
                clients[userId].sock.end();
            } catch (error) {
                console.error(`Logout error:`, error);
            }
        }
        
        delete clients[userId];
        clearSession(userId);
        
        console.log(`User ${userId} logged out`);
    }
    
    res.json({ 
        success: true, 
        message: "Logged out successfully" 
    });
});

// Reset session
app.post("/reset/:userId", (req, res) => {
    const { userId } = req.params;
    
    try {
        // Close existing session if any
        if (clients[userId] && clients[userId].sock) {
            try {
                clients[userId].sock.end();
            } catch (error) {
                console.error(`Error closing session:`, error);
            }
            delete clients[userId];
        }
        
        // Clear session files
        clearSession(userId);
        
        res.json({ 
            success: true, 
            message: "Session reset successfully" 
        });
    } catch (error) {
        console.error(`Reset error:`, error);
        res.status(500).json({
            success: false,
            error: "Failed to reset session",
            details: error.message
        });
    }
});

// Health check
app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "running",
        activeSessions: Object.keys(clients).length,
        uptime: process.uptime()
    });
});

// Error handlers
process.on("uncaughtException", (err) => {
    console.error("Uncaught Exception:", err);
    // Keep process alive
});

process.on("unhandledRejection", (err) => {
    console.error("Unhandled Rejection:", err);
    // Keep process alive
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 WhatsApp API Server running on port ${PORT}`);
});
