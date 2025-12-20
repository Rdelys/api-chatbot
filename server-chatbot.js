const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mysql = require("mysql2/promise");
const axios = require("axios");

// Supprimez cette ligne puisque vous n'utilisez plus .env
// require('dotenv').config();

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

// ============================================
// CONFIGURATION DIRECTE DANS LE CODE
// ============================================

// Configuration MySQL - DIRECT DANS LE CODE
const dbConfig = {
    host: '127.0.0.1',           // ← Votre host MySQL
    port: 3306,                  // ← Port MySQL
    user: 'laraveluser',         // ← Votre utilisateur MySQL
    password: 'livebeauty',      // ← Votre mot de passe MySQL  
    database: 'original-studio', // ← Votre base de données
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 20000,
    socketPath: null,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
};

console.log("🔧 Configuration MySQL:", {
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database
});

const pool = mysql.createPool(dbConfig);

// Configuration DeepL - DIRECT DANS LE CODE
const DEEPL_API_KEY = 'e97d1e99-c844-4284-9654-56220dd7b994:fx'; // ← Votre clé DeepL
const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';  // ← URL complète

console.log("🔧 Configuration DeepL:", {
    hasKey: !!DEEPL_API_KEY,
    url: DEEPL_API_URL,
    keyPreview: DEEPL_API_KEY.substring(0, 15) + '...'
});

// ============================================
// TEST DEEPL SIMPLE
// ============================================

async function testDeepLConnection() {
    console.log("🧪 Test connexion DeepL...");
    
    try {
        const response = await axios({
            method: 'POST',
            url: DEEPL_API_URL,
            headers: {
                'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: {
                text: ['Hello'],
                target_lang: 'FR'
            },
            timeout: 10000
        });
        
        if (response.data?.translations?.[0]) {
            console.log("✅ DeepL fonctionne!");
            console.log("✅ Test:", "Hello →", response.data.translations[0].text);
            return true;
        }
    } catch (error) {
        console.error("❌ Erreur test DeepL:", error.message);
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", error.response.data?.message || error.response.data);
        }
    }
    
    return false;
}

// ============================================
// FONCTIONS DE TRADUCTION
// ============================================

async function translateWithDeepL(text, targetLang, sourceLang = null) {
    console.log(`🔧 DeepL: "${text.substring(0, 50)}..." → ${targetLang}`);
    
    try {
        const data = {
            text: [text],
            target_lang: targetLang
        };
        
        if (sourceLang && sourceLang !== 'auto') {
            data.source_lang = sourceLang;
        }
        
        const response = await axios({
            method: 'POST',
            url: DEEPL_API_URL,
            headers: {
                'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            data: data,
            timeout: 10000
        });
        
        if (response.data?.translations?.[0]) {
            const translation = response.data.translations[0];
            console.log(`✅ DeepL réussi: "${text.substring(0, 30)}..." → "${translation.text.substring(0, 30)}..."`);
            return {
                translated: translation.text,
                detected_lang: translation.detected_source_language || sourceLang
            };
        }
        
    } catch (error) {
        console.error("❌ Erreur DeepL:", error.message);
        if (error.response?.status === 403) {
            console.error("❌ Clé API DeepL invalide ou expirée!");
        }
    }
    
    return null;
}

// Détection de langue simple (fallback)
function detectLanguageSimple(text) {
    const textLower = text.toLowerCase();
    
    const patterns = {
        'EN': /\b(hello|hi|thanks|thank you|please|good morning|how are you)\b/i,
        'IT': /\b(ciao|buongiorno|grazie|per favore|arrivederci)\b/i,
        'ES': /\b(hola|buenos días|gracias|por favor|adiós)\b/i,
        'DE': /\b(hallo|guten morgen|danke|bitte|auf wiedersehen)\b/i,
        'FR': /\b(bonjour|merci|s\'il vous plaît|salut|au revoir)\b/i
    };
    
    for (const [lang, pattern] of Object.entries(patterns)) {
        if (pattern.test(textLower)) {
            return lang;
        }
    }
    
    return 'EN';
}

// Fonction principale de traduction avec fallback
async function translateText(text, targetLang, sourceLang = null) {
    // Essayer DeepL d'abord
    const deepLResult = await translateWithDeepL(text, targetLang, sourceLang);
    
    if (deepLResult) {
        return deepLResult;
    }
    
    // Fallback à la détection simple
    console.warn("⚠️ DeepL échoué, utilisation du fallback");
    
    const detectedLang = sourceLang || detectLanguageSimple(text);
    
    // Traduction basique
    const translations = {
        'hello': { FR: 'bonjour', ES: 'hola', IT: 'ciao', DE: 'hallo' },
        'hi': { FR: 'salut', ES: 'hola', IT: 'ciao', DE: 'hallo' },
        'thanks': { FR: 'merci', ES: 'gracias', IT: 'grazie', DE: 'danke' },
        'thank you': { FR: 'merci', ES: 'gracias', IT: 'grazie', DE: 'danke' },
        'please': { FR: 's\'il vous plaît', ES: 'por favor', IT: 'per favore', DE: 'bitte' }
    };
    
    let translatedText = text;
    const textLower = text.toLowerCase();
    
    for (const [key, langs] of Object.entries(translations)) {
        if (textLower.includes(key) && langs[targetLang]) {
            translatedText = textLower.replace(key, langs[targetLang]);
            break;
        }
    }
    
    return {
        translated: translatedText,
        detected_lang: detectedLang
    };
}

// ============================================
// FONCTIONS MYSQL (inchangées)
// ============================================

async function storeMessage(userId, pseudo, message, sender = 'client', read = false, replied = false, originalLanguage = null, translatedMessage = null, translationTarget = null) {
    try {
        const connection = await pool.getConnection();
        try {
            const [result] = await connection.execute(
                `INSERT INTO chat_messages 
                 (user_id, pseudo, message, sender, \`read\`, replied, original_language, translated_message, translation_target, created_at, updated_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [userId, pseudo, message, sender, read ? 1 : 0, replied ? 1 : 0, originalLanguage, translatedMessage, translationTarget]
            );
            console.log(`💾 Message stocké pour ${pseudo}`);
            return result.insertId;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("❌ Erreur stockage message:", error.message);
        return null;
    }
}

async function getUserPreferredLanguage(userId) {
    try {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT preferred_language FROM users WHERE id = ?`,
                [userId]
            );
            return rows[0]?.preferred_language || 'FR';
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("❌ Erreur récupération langue:", error.message);
        return 'FR';
    }
}

async function getAllUnreadMessages() {
    try {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT cm.* 
                FROM chat_messages cm
                WHERE cm.sender = 'client' 
                AND cm.\`read\` = 0
                ORDER BY cm.created_at`
            );
            return rows;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("❌ Erreur récupération messages:", error.message);
        return [];
    }
}

async function markMessagesAsRead(userId) {
    try {
        const connection = await pool.getConnection();
        try {
            await connection.execute(
                `UPDATE chat_messages SET \`read\` = 1, read_at = NOW() 
                 WHERE user_id = ? AND sender = 'client' AND \`read\` = 0`,
                [userId]
            );
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("❌ Erreur marquage lu:", error.message);
    }
}

// ============================================
// LOGIQUE SOCKET (inchangée)
// ============================================

let admins = {};
let clients = {};
let userLanguages = {};

io.on("connection", (socket) => {
    console.log("📌 Nouveau socket :", socket.id);

    socket.on("identify", async (data) => {
        console.log("🆔 Identification:", data.type);

        if (data.type === "admin") {
            admins[socket.id] = true;
            console.log("👑 Admin connecté");
            
            try {
                const unreadMessages = await getAllUnreadMessages();
                console.log(`📦 Messages en attente: ${unreadMessages.length}`);
                
                unreadMessages.forEach(msg => {
                    socket.emit("admin-new-message", {
                        userId: msg.user_id,
                        pseudo: msg.pseudo,
                        message: msg.translated_message || msg.message,
                        original_message: msg.message,
                        original_language: msg.original_language,
                        translated: !!msg.translated_message
                    });
                });
            } catch (error) {
                console.error("❌ Erreur chargement:", error.message);
            }
            return;
        }
        
        if (data.type === "client") {
            const userId = String(data.userId).trim();
            clients[userId] = socket.id;

            const preferredLang = await getUserPreferredLanguage(userId);
            userLanguages[userId] = preferredLang;
            console.log(`🙋 Client ${data.pseudo}, langue: ${preferredLang}`);
        }
    });

    socket.on("client-message", async (data) => {
        const userId = String(data.userId).trim();
        const pseudo = data.pseudo;
        const message = data.message;

        console.log(`📨 ${pseudo}: ${message}`);

        // Traduire si nécessaire
        const translation = await translateText(message, 'FR');
        
        console.log(`🌐 ${translation.detected_lang} → FR: ${translation.translated}`);

        // Stocker
        await storeMessage(
            userId, pseudo, message, 'client', false, false,
            translation.detected_lang, 
            translation.translated !== message ? translation.translated : null,
            'FR'
        );

        // Envoyer aux admins
        const adminSockets = Object.keys(admins);
        if (adminSockets.length > 0) {
            adminSockets.forEach(adminSocket => {
                io.to(adminSocket).emit("admin-new-message", {
                    userId,
                    pseudo,
                    message: translation.translated,
                    original_message: translation.detected_lang !== 'FR' ? message : null,
                    original_language: translation.detected_lang,
                    translated: translation.translated !== message
                });
            });
            
            await markMessagesAsRead(userId);
        } else {
            const clientSocket = clients[userId];
            if (clientSocket) {
                const userLang = userLanguages[userId] || 'FR';
                let autoReply = "Nous sommes absents. Votre message a été enregistré.";
                
                if (userLang !== 'FR') {
                    const replyTranslation = await translateText(autoReply, userLang, 'FR');
                    autoReply = replyTranslation.translated;
                }
                
                io.to(clientSocket).emit("bot-reply", {
                    message: autoReply
                });
            }
        }
    });

    socket.on("admin-reply", async (data) => {
        const userId = String(data.userId).trim();
        const msg = data.message;
        const clientSocket = clients[userId];

        console.log(`👑 Admin → ${userId}: ${msg}`);

        // Traduire pour le client
        const userLang = userLanguages[userId] || await getUserPreferredLanguage(userId);
        let finalMessage = msg;
        let isTranslated = false;

        if (userLang !== 'FR') {
            const translation = await translateText(msg, userLang, 'FR');
            finalMessage = translation.translated;
            isTranslated = translation.translated !== msg;
            console.log(`🌐 FR → ${userLang}: ${finalMessage}`);
        }

        // Stocker
        await storeMessage(
            userId, 'Admin', msg, 'admin', true, true,
            'FR', 
            isTranslated ? finalMessage : null,
            userLang
        );
        
        // Envoyer au client
        if (clientSocket) {
            io.to(clientSocket).emit("chatbot-reply", {
                sender: "Support",
                message: finalMessage,
                translated: isTranslated
            });
            console.log(`📤 Message envoyé à ${userId}`);
        }
    });

    socket.on("load-stored-messages", async () => {
        if (admins[socket.id]) {
            try {
                const allUnread = await getAllUnreadMessages();
                const unreadCount = allUnread.length;
                console.log(`📊 Messages stockés: ${unreadCount}`);
                
                socket.emit("stored-messages-count", { count: unreadCount });
                
                if (unreadCount > 0) {
                    const grouped = {};
                    allUnread.forEach(msg => {
                        const userId = msg.user_id;
                        if (!grouped[userId]) {
                            grouped[userId] = {
                                userId: userId,
                                pseudo: msg.pseudo,
                                messages: [],
                                count: 0
                            };
                        }
                        const displayMessage = msg.translated_message || msg.message;
                        grouped[userId].messages.push(displayMessage);
                        grouped[userId].count++;
                    });
                    
                    socket.emit("stored-messages", Object.values(grouped));
                }
            } catch (error) {
                console.error("❌ Erreur chargement stocké:", error.message);
                socket.emit("stored-messages-count", { count: 0 });
            }
        }
    });

    socket.on("disconnect", () => {
        console.log("❌ Déconnexion:", socket.id);
        
        if (admins[socket.id]) {
            delete admins[socket.id];
        }
        
        for (let userId in clients) {
            if (clients[userId] === socket.id) {
                delete clients[userId];
                delete userLanguages[userId];
                break;
            }
        }
    });
});

server.listen(4000, async () => {
    console.log("🚀 Serveur chatbot sur port 4000");
    console.log("🔧 Configuration en dur activée");
    
    // Tester DeepL
    const deepLWorking = await testDeepLConnection();
    
    if (!deepLWorking) {
        console.warn("⚠️ DeepL ne fonctionne pas - traduction basique activée");
        console.warn("ℹ️ Pour activer DeepL, obtenez une clé valide sur: https://www.deepl.com/pro#developer");
    }
    
    console.log("✅ Serveur prêt!");
});