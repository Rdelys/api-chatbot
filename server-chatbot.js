// api-chatbot/server-chatbot.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mysql = require("mysql2/promise");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: [
            "https://livebeautyofficial.com",
            "https://www.livebeautyofficial.com"
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    path: "/chatbot/socket.io"
});

// Configuration MySQL
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'laraveluser',
    password: process.env.DB_PASSWORD || 'livebeauty',
    database: process.env.DB_DATABASE || 'original-studio',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// Fonctions de base de données
async function storeMessage(userId, pseudo, message, sender = 'client', read = false, replied = false) {
    try {
        const [result] = await pool.execute(
            `INSERT INTO chat_messages (user_id, pseudo, message, sender, \`read\`, replied, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [userId, pseudo, message, sender, read ? 1 : 0, replied ? 1 : 0]
        );
        return result.insertId;
    } catch (error) {
        console.error("❌ Erreur stockage message:", error);
        return null;
    }
}

async function getUnreadMessagesCount() {
    try {
        const [rows] = await pool.execute(
            `SELECT COUNT(*) as count FROM chat_messages WHERE sender = 'client' AND \`read\` = 0`
        );
        return rows[0].count;
    } catch (error) {
        console.error("❌ Erreur comptage messages:", error);
        return 0;
    }
}

async function getUnreadMessages() {
    try {
        const [rows] = await pool.execute(
            `SELECT * FROM chat_messages WHERE sender = 'client' AND \`read\` = 0 ORDER BY created_at`
        );
        return rows;
    } catch (error) {
        console.error("❌ Erreur récupération messages:", error);
        return [];
    }
}

async function markMessagesAsRead(userId) {
    try {
        await pool.execute(
            `UPDATE chat_messages SET \`read\` = 1, read_at = NOW() 
             WHERE user_id = ? AND sender = 'client' AND \`read\` = 0`,
            [userId]
        );
    } catch (error) {
        console.error("❌ Erreur marquage comme lu:", error);
    }
}

async function getClientHistory(userId) {
    try {
        const [rows] = await pool.execute(
            `SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at`,
            [userId]
        );
        return rows;
    } catch (error) {
        console.error("❌ Erreur historique:", error);
        return [];
    }
}

// STOCKAGE SOCKET
let admins = {};          // { socketId: true }
let clients = {};         // { userId: socketId }

io.on("connection", (socket) => {

    console.log("📌 Nouveau socket connecté :", socket.id);

    // IDENTIFICATION
   socket.on("identify", async (data) => {
    console.log("🆔 IDENTIFICATION :", data);

    // ADMIN
    if (data.type === "admin") {
        admins[socket.id] = true;
        console.log("👑 ADMIN connecté :", socket.id);
        
        // Envoyer TOUS les messages non lus
        const unreadMessages = await getAllUnreadMessages();
        console.log(`📦 Messages non lus à envoyer: ${unreadMessages.length}`);
        
        if (unreadMessages.length > 0) {
            // Grouper par utilisateur
            const grouped = {};
            unreadMessages.forEach(msg => {
                if (!grouped[msg.user_id]) {
                    grouped[msg.user_id] = {
                        userId: msg.user_id,
                        pseudo: msg.pseudo,
                        messages: [],
                        lastMessage: msg.message,
                        count: 0
                    };
                }
                grouped[msg.user_id].messages.push(msg.message);
                grouped[msg.user_id].count++;
                grouped[msg.user_id].lastMessage = msg.message;
            });
            
            // Envoyer chaque groupe
            Object.values(grouped).forEach(group => {
                socket.emit("admin-new-message", {
                    userId: group.userId,
                    pseudo: group.pseudo,
                    message: group.lastMessage,
                    count: group.count
                });
            });
        }
        return;
    }
    
        // CLIENT
        if (data.type === "client") {
            const uid = String(data.userId).trim();
            clients[uid] = socket.id;

            console.log(`🙋 CLIENT identifié : ${uid} → socket ${socket.id}`);

            // Envoyer l'historique stocké
            const history = await getClientHistory(uid);
            if (history.length > 0) {
                history.forEach(msg => {
                    if (msg.sender === 'admin') {
                        socket.emit("chatbot-reply", {
                            sender: "Support",
                            message: msg.message
                        });
                    }
                });
            }
        }
    });

    // MESSAGE CLIENT → ADMIN (ou stockage)
    socket.on("client-message", async (data) => {
        const userId = String(data.userId).trim();
        const pseudo = data.pseudo;
        const message = data.message;

        console.log("📨 Message CLIENT reçu :", data);

        // Stocker TOUJOURS le message en BDD
        const messageId = await storeMessage(userId, pseudo, message, 'client', false, false);

        if (messageId) {
            console.log(`💾 Message stocké en BDD (ID: ${messageId}) pour user ${userId}`);
        }

        // Vérifier si admin connecté
        const adminSockets = Object.keys(admins);
        
        if (adminSockets.length > 0) {
            // Admin connecté → envoyer en direct
            adminSockets.forEach(adminSocket => {
                io.to(adminSocket).emit("admin-new-message", {
                    userId,
                    pseudo,
                    message
                });
            });
            
            // Marquer comme lu
            await markMessagesAsRead(userId);
        } else {
            // Admin non connecté → réponse automatique
            const clientSocket = clients[userId];
            if (clientSocket) {
                io.to(clientSocket).emit("bot-reply", {
                    message: "Nous sommes absents pour le moment 😘. Votre message a été enregistré et nous vous répondrons dès que possible."
                });
            }
        }
    });

    // Ajoutez cette fonction pour récupérer tous les messages non lus
    async function getAllUnreadMessages() {
        try {
            const [rows] = await pool.execute(
                `SELECT cm.* 
                FROM chat_messages cm
                WHERE cm.sender = 'client' 
                AND cm.\`read\` = 0
                ORDER BY cm.created_at`
            );
            return rows;
        } catch (error) {
            console.error("❌ Erreur récupération messages non lus:", error);
            return [];
        }
    }

    // MESSAGE ADMIN → CLIENT
    socket.on("admin-reply", async (data) => {
        const userId = String(data.userId).trim();
        const msg = data.message;
        const clientSocket = clients[userId];

        console.log(`👑 ADMIN → CLIENT ${userId} :`, msg);

        // Stocker la réponse admin
        await storeMessage(userId, 'Admin', msg, 'admin', true, true);

        if (clientSocket) {
            // Client en ligne → envoyer immédiatement
            io.to(clientSocket).emit("chatbot-reply", {
                sender: "Support",
                message: msg
            });
        }
        // Si client hors ligne, le message reste stocké et sera envoyé à sa reconnexion
    });

    // CHARGEMENT INITIAL POUR ADMIN
        socket.on("load-stored-messages", async () => {
            if (admins[socket.id]) {
                const allUnread = await getAllUnreadMessages();
                const unreadCount = allUnread.length;
                
                console.log(`📊 Chargement initial: ${unreadCount} messages stockés`);
                
                socket.emit("stored-messages-count", { count: unreadCount });
                
                if (unreadCount > 0) {
                    // Grouper par utilisateur
                    const grouped = {};
                    allUnread.forEach(msg => {
                        if (!grouped[msg.user_id]) {
                            grouped[msg.user_id] = {
                                userId: msg.user_id,
                                pseudo: msg.pseudo,
                                messages: [],
                                messageIds: [],
                                count: 0
                            };
                        }
                        grouped[msg.user_id].messages.push(msg.message);
                        grouped[msg.user_id].messageIds.push(msg.id);
                        grouped[msg.user_id].count++;
                    });
                    
                    // Envoyer sous forme de tableau
                    const groupedArray = Object.values(grouped);
                    console.log(`📤 Envoi de ${groupedArray.length} conversations stockées`);
                    socket.emit("stored-messages", groupedArray);
                }
            }
        });

    // MARQUER COMME LU
    socket.on("mark-as-read", async (data) => {
        if (admins[socket.id] && data.userId) {
            await markMessagesAsRead(data.userId);
        }
    });

    // DECONNEXION
    socket.on("disconnect", () => {
        console.log("❌ Déconnexion :", socket.id);

        // enlever admin
        if (admins[socket.id])
            delete admins[socket.id];

        // enlever client
        for (let uid in clients)
            if (clients[uid] === socket.id)
                delete clients[uid];
    });
});

server.listen(4000, () => {
    console.log("🚀 Serveur chatbot opérationnel sur le port 4000");
});