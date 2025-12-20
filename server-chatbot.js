const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mysql = require("mysql2/promise");
const axios = require("axios"); // Ajouter axios pour les appels API

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
    host: process.env.DB_HOST || '127.0.0.1', // Utiliser 127.0.0.1 au lieu de localhost
    port: process.env.DB_PORT || 3306, // Ajouter le port explicitement
    user: process.env.DB_USER || 'laraveluser',
    password: process.env.DB_PASSWORD || 'livebeauty',
    database: process.env.DB_DATABASE || 'original-studio',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000 // Timeout de connexion
};

const pool = mysql.createPool(dbConfig);

// Configuration DeepL
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_API_URL = process.env.DEEPL_API_URL || 'https://api-free.deepl.com';

// Fonction de traduction DeepL
async function translateText(text, targetLang, sourceLang = null) {
    try {
        const data = {
            text: [text],
            target_lang: targetLang.toUpperCase()
        };
        
        if (sourceLang) {
            data.source_lang = sourceLang.toUpperCase();
        }
        
        const response = await axios({
            method: 'post',
            url: `${DEEPL_API_URL}/v2/translate`,
            headers: {
                'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: data,
            timeout: 10000
        });
        
        if (response.data && response.data.translations && response.data.translations[0]) {
            return {
                translated: response.data.translations[0].text,
                detected_lang: response.data.translations[0].detected_source_language
            };
        }
    } catch (error) {
        console.error("❌ Erreur traduction DeepL:", error.message);
        return null;
    }
}

// Fonction pour détecter la langue
async function detectLanguage(text) {
    try {
        const response = await axios({
            method: 'post',
            url: `${DEEPL_API_URL}/v2/translate`,
            headers: {
                'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: {
                text: [text],
                target_lang: 'EN'
            },
            timeout: 5000
        });
        
        if (response.data && response.data.translations && response.data.translations[0]) {
            return response.data.translations[0].detected_source_language;
        }
    } catch (error) {
        console.error("❌ Erreur détection langue:", error.message);
    }
    return null;
}

// Fonctions de base de données
// Modifier storeMessage pour inclure la traduction
async function storeMessage(userId, pseudo, message, sender = 'client', read = false, replied = false, originalLanguage = null, translatedMessage = null, translationTarget = null) {
    try {
        const [result] = await pool.execute(
            `INSERT INTO chat_messages 
             (user_id, pseudo, message, sender, \`read\`, replied, original_language, translated_message, translation_target, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [userId, pseudo, message, sender, read ? 1 : 0, replied ? 1 : 0, originalLanguage, translatedMessage, translationTarget]
        );
        return result.insertId;
    } catch (error) {
        console.error("❌ Erreur stockage message:", error);
        return null;
    }
}

// Obtenir la langue préférée de l'utilisateur
async function getUserPreferredLanguage(userId) {
    try {
        const [rows] = await pool.execute(
            `SELECT preferred_language FROM users WHERE id = ?`,
            [userId]
        );
        return rows[0]?.preferred_language || 'FR';
    } catch (error) {
        return 'FR';
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
let userLanguages = {}; // Stocker les langues des utilisateurs

io.on("connection", (socket) => {

    console.log("📌 Nouveau socket connecté :", socket.id);

    // IDENTIFICATION
   socket.on("identify", async (data) => {
    console.log("🆔 IDENTIFICATION :", data);

    // ADMIN
    if (data.type === "admin") {
        admins[socket.id] = true;
        console.log("👑 ADMIN connecté :", socket.id);
        
        const preferredLang = await getUserPreferredLanguage(uid);
        userLanguages[uid] = preferredLang;

        console.log(`🙋 CLIENT identifié : ${uid} → langue: ${preferredLang}`);

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

         // 1. Détecter la langue du message
        const detectedLang = await detectLanguage(message);
        
        // 2. Déterminer la langue cible (pour l'admin)
        let translationTarget = 'FR'; // Par défaut français pour l'admin
        let translatedMessage = null;
        
        if (detectedLang && detectedLang !== 'FR') {
            // Si le message n'est pas en français, le traduire
            const translation = await translateText(message, 'FR', detectedLang);
            if (translation) {
                translatedMessage = translation.translated;
                console.log(`🌐 Traduction client→admin: ${detectedLang} → FR`);
            }
        }
        // 3. Stocker avec la langue originale et la traduction
        const messageId = await storeMessage(
            userId, pseudo, message, 'client', false, false,
            detectedLang, translatedMessage, translationTarget
        );


        if (messageId) {
            console.log(`💾 Message stocké en BDD (ID: ${messageId}) pour user ${userId}`);
        }

        // Vérifier si admin connecté
        const adminSockets = Object.keys(admins);
        
        if (adminSockets.length > 0) {

            // Préparer le message pour l'admin
            const adminMessage = translatedMessage || message;
            const languageInfo = detectedLang ? ` [${detectedLang}→FR]` : '';
            

            // Admin connecté → envoyer en direct
            adminSockets.forEach(adminSocket => {
                io.to(adminSocket).emit("admin-new-message", {
                    userId,
                    pseudo,
                    message: adminMessage,
                    original_message: message,
                    original_language: detectedLang,
                    translated: !!translatedMessage,
                    language_info: languageInfo
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

        // 1. Obtenir la langue de l'utilisateur
        const userLang = userLanguages[userId] || 'FR';
        let translatedMessage = null;
        let originalLanguage = 'FR';

        // 2. Traduire si nécessaire
        if (userLang !== 'FR') {
            const translation = await translateText(msg, userLang, 'FR');
            if (translation) {
                translatedMessage = translation.translated;
                originalLanguage = 'FR';
                console.log(`🌐 Traduction admin→client: FR → ${userLang}`);
            }
        }

        // 3. Stocker le message
        await storeMessage(
            userId, 'Admin', msg, 'admin', true, true,
            originalLanguage, translatedMessage, userLang
        );
        
         // 4. Envoyer au client
        if (clientSocket) {
            const finalMessage = translatedMessage || msg;
            io.to(clientSocket).emit("chatbot-reply", {
                sender: "Support",
                message: finalMessage,
                translated: !!translatedMessage
            });
        }
    });

    // MODIFIER stored-messages pour inclure les traductions
    socket.on("load-stored-messages", async () => {
        if (admins[socket.id]) {
            const allUnread = await getAllUnreadMessages();
            const unreadCount = allUnread.length;
            
            console.log(`📊 Chargement initial: ${unreadCount} messages stockés`);
            
            socket.emit("stored-messages-count", { count: unreadCount });
            
            if (unreadCount > 0) {
                const grouped = {};
                allUnread.forEach(msg => {
                    if (!grouped[msg.user_id]) {
                        grouped[msg.user_id] = {
                            userId: msg.user_id,
                            pseudo: msg.pseudo,
                            messages: [],
                            original_messages: [],
                            languages: [],
                            count: 0
                        };
                    }
                    
                    // Utiliser le message traduit si disponible, sinon l'original
                    const displayMessage = msg.translated_message || msg.message;
                    grouped[msg.user_id].messages.push(displayMessage);
                    grouped[msg.user_id].original_messages.push(msg.message);
                    grouped[msg.user_id].languages.push(msg.original_language);
                    grouped[msg.user_id].count++;
                });
                
                const groupedArray = Object.values(grouped);
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