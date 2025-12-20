const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const mysql = require("mysql2/promise");
const axios = require("axios");

// Charger le .env au début du fichier
require('dotenv').config();

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

// Configuration MySQL - FORCER IPv4
const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1', // IMPORTANT: 127.0.0.1 au lieu de localhost
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'laraveluser',
    password: process.env.DB_PASSWORD || 'livebeauty',
    database: process.env.DB_DATABASE || 'original-studio',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000,
    socketPath: null, // Désactiver socket Unix
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
};

console.log("🔧 Configuration MySQL:", {
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user
});

const pool = mysql.createPool(dbConfig);

// Configuration DeepL
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_API_URL = process.env.DEEPL_API_URL || 'https://api-free.deepl.com/v2';

console.log("🔧 Configuration DeepL:", {
    hasKey: !!DEEPL_API_KEY,
    url: DEEPL_API_URL,
    keyPreview: DEEPL_API_KEY ? DEEPL_API_KEY.substring(0, 10) + '...' : 'none'
});

// Tester la connexion MySQL
async function testMySQLConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Connexion MySQL établie avec succès');
        
        // Tester une requête simple
        const [rows] = await connection.query('SELECT 1 as test');
        console.log('✅ Test requête MySQL:', rows[0].test);
        
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ Erreur connexion MySQL:', error.message);
        console.error('❌ Code erreur:', error.code);
        console.error('❌ Numéro erreur:', error.errno);
        return false;
    }
}

// Fonction de traduction DeepL - version corrigée
async function translateText(text, targetLang, sourceLang = null) {
    if (!DEEPL_API_KEY) {
        console.warn("⚠️ DeepL API key non configurée");
        return null;
    }
    
    try {
        const data = {
            text: [text],
            target_lang: targetLang.toUpperCase()
        };
        
        if (sourceLang) {
            data.source_lang = sourceLang.toUpperCase();
        }
        
        console.log("📤 Requête DeepL:", { targetLang, sourceLang, textLength: text.length });
        
        const response = await axios({
            method: 'post',
            url: DEEPL_API_URL + '/translate',
            headers: {
                'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Node.js ChatBot/1.0'
            },
            data: data,
            timeout: 15000
        });
        
        console.log("✅ Réponse DeepL reçue - Status:", response.status);
        
        if (response.data && response.data.translations && response.data.translations[0]) {
            return {
                translated: response.data.translations[0].text,
                detected_lang: response.data.translations[0].detected_source_language
            };
        }
    } catch (error) {
        console.error("❌ Erreur traduction DeepL:", error.message);
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Headers:", error.response.headers);
            if (error.response.status === 403) {
                console.error("❌ Clé API DeepL invalide ou expirée!");
            }
        }
        return null;
    }
}

// Fonction simple de détection de langue
function detectLanguageSimple(text) {
    const patterns = {
        'IT': /\b(cio|grazie|per favore|ciao|buongiorno|grazie mille|come stai)\b/i,
        'EN': /\b(hello|hi|thanks|thank you|please|good morning|hey|how are you)\b/i,
        'ES': /\b(hola|gracias|por favor|buenos días|adiós|¿cómo estás?)\b/i,
        'DE': /\b(hallo|danke|bitte|guten morgen|auf wiedersehen|wie geht's)\b/i,
        'FR': /\b(bonjour|merci|s'il vous plaît|salut|au revoir|comment ça va)\b/i,
        'PT': /\b(olá|obrigado|por favor|bom dia|adeus|como está)\b/i,
        'NL': /\b(hallo|dank je|alsjeblieft|goedemorgen|doei|hoe gaat het)\b/i
    };
    
    let maxMatches = 0;
    let detectedLang = 'FR';
    
    for (const [lang, pattern] of Object.entries(patterns)) {
        const matches = (text.match(pattern) || []).length;
        if (matches > maxMatches) {
            maxMatches = matches;
            detectedLang = lang;
        }
    }
    
    return detectedLang;
}

// Fonction pour détecter la langue
async function detectLanguage(text) {
    // Si DeepL n'est pas configuré, utiliser la détection simple
    if (!DEEPL_API_KEY) {
        console.warn("⚠️ Using simple language detection");
        return detectLanguageSimple(text);
    }
    
    try {
        console.log("🔍 Détection langue avec DeepL...");
        const response = await axios({
            method: 'post',
            url: DEEPL_API_URL + '/translate',
            headers: {
                'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Node.js ChatBot/1.0'
            },
            data: {
                text: [text],
                target_lang: 'EN'
            },
            timeout: 10000
        });
        
        if (response.data && response.data.translations && response.data.translations[0]) {
            const lang = response.data.translations[0].detected_source_language;
            console.log(`✅ Langue détectée: ${lang}`);
            return lang ? lang.toUpperCase() : 'FR';
        }
    } catch (error) {
        console.error("❌ Erreur détection langue DeepL, fallback to simple detection:", error.message);
        return detectLanguageSimple(text);
    }
    
    return 'FR';
}

// Fonctions de base de données avec meilleure gestion d'erreur
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
            console.log(`💾 Message stocké pour user ${userId}, ID: ${result.insertId}`);
            return result.insertId;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("❌ Erreur stockage message:", error.message);
        console.error("❌ Code SQL:", error.code);
        return null;
    }
}

// Obtenir la langue préférée de l'utilisateur
async function getUserPreferredLanguage(userId) {
    try {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT preferred_language FROM users WHERE id = ?`,
                [userId]
            );
            const lang = rows[0]?.preferred_language || 'FR';
            console.log(`🌐 Langue préférée pour ${userId}: ${lang}`);
            return lang;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("❌ Erreur récupération langue utilisateur:", error.message);
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
        console.error("❌ Erreur récupération messages non lus:", error.message);
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
            console.log(`📝 Messages marqués comme lus pour ${userId}`);
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("❌ Erreur marquage comme lu:", error.message);
    }
}

async function getClientHistory(userId) {
    try {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(
                `SELECT * FROM chat_messages WHERE user_id = ? ORDER BY created_at`,
                [userId]
            );
            return rows;
        } finally {
            connection.release();
        }
    } catch (error) {
        console.error("❌ Erreur historique:", error.message);
        return [];
    }
}

// STOCKAGE SOCKET
let admins = {};
let clients = {};
let userLanguages = {};

io.on("connection", (socket) => {
    console.log("📌 Nouveau socket connecté :", socket.id);

    socket.on("identify", async (data) => {
        console.log("🆔 IDENTIFICATION :", data);

        if (data.type === "admin") {
            admins[socket.id] = true;
            console.log("👑 ADMIN connecté :", socket.id);
            
            try {
                const unreadMessages = await getAllUnreadMessages();
                console.log(`📦 Messages non lus à envoyer: ${unreadMessages.length}`);
                
                if (unreadMessages.length > 0) {
                    const grouped = {};
                    unreadMessages.forEach(msg => {
                        const userId = msg.user_id?.toString() || 'unknown';
                        if (!grouped[userId]) {
                            grouped[userId] = {
                                userId: userId,
                                pseudo: msg.pseudo || 'User',
                                messages: [],
                                lastMessage: msg.message,
                                count: 0
                            };
                        }
                        grouped[userId].messages.push(msg.message);
                        grouped[userId].count++;
                        grouped[userId].lastMessage = msg.message;
                    });
                    
                    Object.values(grouped).forEach(group => {
                        socket.emit("admin-new-message", {
                            userId: group.userId,
                            pseudo: group.pseudo,
                            message: group.lastMessage,
                            count: group.count
                        });
                    });
                }
            } catch (error) {
                console.error("❌ Erreur chargement messages:", error.message);
            }
            return;
        }
        
        if (data.type === "client") {
            const userId = String(data.userId).trim();
            clients[userId] = socket.id;

            try {
                const preferredLang = await getUserPreferredLanguage(userId);
                userLanguages[userId] = preferredLang;
                console.log(`🙋 CLIENT identifié : ${userId} → socket ${socket.id}, langue: ${preferredLang}`);

                const history = await getClientHistory(userId);
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
            } catch (error) {
                console.error("❌ Erreur identification client:", error.message);
            }
        }
    });

    socket.on("client-message", async (data) => {
        const userId = String(data.userId).trim();
        const pseudo = data.pseudo;
        const message = data.message;

        console.log("📨 Message CLIENT reçu de", pseudo + ":", message.substring(0, 100));

        let detectedLang = 'FR';
        let translatedMessage = null;
        
        try {
            detectedLang = await detectLanguage(message);
            
            if (detectedLang && detectedLang !== 'FR') {
                console.log(`🌐 Détection langue client: ${detectedLang}`);
                const translation = await translateText(message, 'FR', detectedLang);
                if (translation) {
                    translatedMessage = translation.translated;
                    console.log(`🌐 Traduction client→admin: ${detectedLang} → FR réussie`);
                } else {
                    console.log(`⚠️ Traduction échouée pour ${detectedLang} → FR`);
                }
            }
        } catch (error) {
            console.error("❌ Erreur traitement message:", error.message);
        }
        
        // Stockage
        try {
            await storeMessage(
                userId, pseudo, message, 'client', false, false,
                detectedLang, translatedMessage, 'FR'
            );
        } catch (error) {
            console.error("❌ Erreur stockage message:", error.message);
        }

        // Envoi à l'admin
        const adminSockets = Object.keys(admins);
        if (adminSockets.length > 0) {
            const adminMessage = translatedMessage || message;
            adminSockets.forEach(adminSocket => {
                io.to(adminSocket).emit("admin-new-message", {
                    userId,
                    pseudo,
                    message: adminMessage,
                    original_message: detectedLang !== 'FR' ? message : null,
                    original_language: detectedLang,
                    translated: !!translatedMessage
                });
            });
            
            try {
                await markMessagesAsRead(userId);
            } catch (error) {
                console.error("❌ Erreur marquage comme lu:", error.message);
            }
        } else {
            const clientSocket = clients[userId];
            if (clientSocket) {
                const userLang = userLanguages[userId] || 'FR';
                let autoReply = "Nous sommes absents pour le moment 😘. Votre message a été enregistré et nous vous répondrons dès que possible.";
                
                if (userLang !== 'FR') {
                    try {
                        const translation = await translateText(autoReply, userLang, 'FR');
                        if (translation) {
                            autoReply = translation.translated;
                        }
                    } catch (error) {
                        console.error("❌ Erreur traduction réponse auto:", error.message);
                    }
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

        console.log(`👑 ADMIN → CLIENT ${userId} :`, msg.substring(0, 100));

        let userLang = 'FR';
        let translatedMessage = null;

        try {
            userLang = userLanguages[userId] || await getUserPreferredLanguage(userId);
            
            if (userLang !== 'FR') {
                console.log(`🌐 Traduction admin→client nécessaire: FR → ${userLang}`);
                const translation = await translateText(msg, userLang, 'FR');
                if (translation) {
                    translatedMessage = translation.translated;
                    console.log(`🌐 Traduction réussie admin→client: FR → ${userLang}`);
                }
            }
        } catch (error) {
            console.error("❌ Erreur traitement réponse admin:", error.message);
        }

        try {
            await storeMessage(
                userId, 'Admin', msg, 'admin', true, true,
                'FR', translatedMessage, userLang
            );
        } catch (error) {
            console.error("❌ Erreur stockage réponse admin:", error.message);
        }
        
        if (clientSocket) {
            const finalMessage = translatedMessage || msg;
            io.to(clientSocket).emit("chatbot-reply", {
                sender: "Support",
                message: finalMessage,
                translated: !!translatedMessage
            });
            console.log(`📤 Message envoyé au client ${userId} (langue: ${userLang})`);
        }
    });

    socket.on("load-stored-messages", async () => {
        if (admins[socket.id]) {
            try {
                const allUnread = await getAllUnreadMessages();
                const unreadCount = allUnread.length;
                console.log(`📊 Chargement initial: ${unreadCount} messages stockés`);
                
                socket.emit("stored-messages-count", { count: unreadCount });
                
                if (unreadCount > 0) {
                    const grouped = {};
                    allUnread.forEach(msg => {
                        const userId = msg.user_id?.toString() || 'unknown';
                        if (!grouped[userId]) {
                            grouped[userId] = {
                                userId: userId,
                                pseudo: msg.pseudo || 'User',
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
                console.error("❌ Erreur chargement messages stockés:", error.message);
                socket.emit("stored-messages-count", { count: 0 });
                socket.emit("stored-messages", []);
            }
        }
    });

    socket.on("disconnect", () => {
        console.log("❌ Déconnexion :", socket.id);
        
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
    console.log("🚀 Serveur chatbot opérationnel sur le port 4000");
    
    // Tester la connexion MySQL
    const mysqlConnected = await testMySQLConnection();
    
    if (!mysqlConnected) {
        console.error("❌ SERVEUR DÉMARRÉ SANS CONNEXION MYSQL!");
        console.error("❌ Les messages ne seront pas sauvegardés!");
    }
    
    // Tester DeepL
    if (DEEPL_API_KEY) {
        console.log('🔧 Test connexion DeepL...');
        try {
            const testTranslation = await translateText("Hello", "FR", "EN");
            if (testTranslation) {
                console.log('✅ DeepL fonctionne:', testTranslation.translated);
            } else {
                console.warn('⚠️ DeepL ne répond pas correctement - Traduction désactivée');
            }
        } catch (error) {
            console.error('❌ Erreur test DeepL:', error.message);
        }
    } else {
        console.warn('⚠️ DeepL API key non configurée');
    }
});