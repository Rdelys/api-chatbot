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

// Configuration MySQL
const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1', // Force IPv4
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'laraveluser',
    password: process.env.DB_PASSWORD || 'livebeauty',
    database: process.env.DB_DATABASE || 'original-studio',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000,
    socketPath: null, // S'assurer qu'aucun socket Unix n'est utilisé
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
};

const pool = mysql.createPool(dbConfig);

// Configuration DeepL
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;
const DEEPL_API_URL = process.env.DEEPL_API_URL || 'https://api-free.deepl.com/v2';

console.log("🔧 Configuration DeepL:", {
    hasKey: !!DEEPL_API_KEY,
    url: DEEPL_API_URL,
    keyPreview: DEEPL_API_KEY ? DEEPL_API_KEY.substring(0, 10) + '...' : 'none'
});

// Fonction de traduction DeepL
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
            timeout: 10000
        });
        
        console.log("✅ Réponse DeepL reçue");
        
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
            console.error("Data:", JSON.stringify(error.response.data));
        }
        return null;
    }
}

// Fonction simple de détection de langue (alternative sans DeepL)
function detectLanguageSimple(text) {
    const patterns = {
        'IT': /\b(cio|grazie|per favore|ciao|buongiorno|grazie mille)\b/i,
        'EN': /\b(hello|hi|thanks|thank you|please|good morning|hey)\b/i,
        'ES': /\b(hola|gracias|por favor|buenos días|adiós)\b/i,
        'DE': /\b(hallo|danke|bitte|guten morgen|auf wiedersehen)\b/i,
        'FR': /\b(bonjour|merci|s'il vous plaît|salut|au revoir)\b/i,
        'PT': /\b(olá|obrigado|por favor|bom dia|adeus)\b/i,
        'NL': /\b(hallo|dank je|alsjeblieft|goedemorgen|doei)\b/i
    };
    
    let maxMatches = 0;
    let detectedLang = 'FR'; // Français par défaut
    
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
            timeout: 5000
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
    
    return 'FR'; // Retourner français par défaut
}

// Fonctions de base de données
async function storeMessage(userId, pseudo, message, sender = 'client', read = false, replied = false, originalLanguage = null, translatedMessage = null, translationTarget = null) {
    try {
        const [result] = await pool.execute(
            `INSERT INTO chat_messages 
             (user_id, pseudo, message, sender, \`read\`, replied, original_language, translated_message, translation_target, created_at, updated_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [userId, pseudo, message, sender, read ? 1 : 0, replied ? 1 : 0, originalLanguage, translatedMessage, translationTarget]
        );
        console.log(`💾 Message stocké pour user ${userId}, ID: ${result.insertId}`);
        return result.insertId;
    } catch (error) {
        console.error("❌ Erreur stockage message:", error.message);
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
        const lang = rows[0]?.preferred_language || 'FR';
        console.log(`🌐 Langue préférée pour ${userId}: ${lang}`);
        return lang;
    } catch (error) {
        console.error("❌ Erreur récupération langue utilisateur:", error.message);
        return 'FR';
    }
}

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

async function markMessagesAsRead(userId) {
    try {
        await pool.execute(
            `UPDATE chat_messages SET \`read\` = 1, read_at = NOW() 
             WHERE user_id = ? AND sender = 'client' AND \`read\` = 0`,
            [userId]
        );
        console.log(`📝 Messages marqués comme lus pour ${userId}`);
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
            
            // Envoyer TOUS les messages non lus
            const unreadMessages = await getAllUnreadMessages();
            console.log(`📦 Messages non lus à envoyer: ${unreadMessages.length}`);
            
            if (unreadMessages.length > 0) {
                // Grouper par utilisateur
                const grouped = {};
                unreadMessages.forEach(msg => {
                    const userId = msg.user_id.toString();
                    if (!grouped[userId]) {
                        grouped[userId] = {
                            userId: userId,
                            pseudo: msg.pseudo,
                            messages: [],
                            lastMessage: msg.message,
                            count: 0
                        };
                    }
                    grouped[userId].messages.push(msg.message);
                    grouped[userId].count++;
                    grouped[userId].lastMessage = msg.message;
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
            const userId = String(data.userId).trim();
            clients[userId] = socket.id;

            // Récupérer et stocker la langue préférée de l'utilisateur
            const preferredLang = await getUserPreferredLanguage(userId);
            userLanguages[userId] = preferredLang;

            console.log(`🙋 CLIENT identifié : ${userId} → socket ${socket.id}, langue: ${preferredLang}`);

            // Envoyer l'historique stocké
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
        }
    });

    // MESSAGE CLIENT → ADMIN
    socket.on("client-message", async (data) => {
        const userId = String(data.userId).trim();
        const pseudo = data.pseudo;
        const message = data.message;

        console.log("📨 Message CLIENT reçu de", pseudo + ":", message.substring(0, 50) + "...");

        // 1. Détecter la langue du message
        const detectedLang = await detectLanguage(message);
        
        // 2. Déterminer la langue cible (pour l'admin)
        let translationTarget = 'FR';
        let translatedMessage = null;
        
        // Si le message n'est pas en français, le traduire pour l'admin
        if (detectedLang && detectedLang !== 'FR') {
            console.log(`🌐 Détection langue client: ${detectedLang}`);
            const translation = await translateText(message, 'FR', detectedLang);
            if (translation) {
                translatedMessage = translation.translated;
                console.log(`🌐 Traduction client→admin: ${detectedLang} → FR réussie`);
            } else {
                console.log(`⚠️ Traduction échouée pour ${detectedLang} → FR`);
            }
        } else {
            console.log(`🌐 Message déjà en français (${detectedLang})`);
        }
        
        // 3. Stocker avec la langue originale et la traduction
        const messageId = await storeMessage(
            userId, pseudo, message, 'client', false, false,
            detectedLang, translatedMessage, translationTarget
        );

        // 4. Envoyer à l'admin
        const adminSockets = Object.keys(admins);
        
        if (adminSockets.length > 0) {
            // Préparer le message pour l'admin
            const adminMessage = translatedMessage || message;
            
            // Admin connecté → envoyer en direct
            adminSockets.forEach(adminSocket => {
                io.to(adminSocket).emit("admin-new-message", {
                    userId,
                    pseudo,
                    message: adminMessage,
                    original_message: detectedLang !== 'FR' ? message : null,
                    original_language: detectedLang,
                    translated: !!translatedMessage,
                    language_info: detectedLang && detectedLang !== 'FR' ? `[${detectedLang}→FR]` : ''
                });
            });
            
            // Marquer comme lu
            await markMessagesAsRead(userId);
        } else {
            // Admin non connecté → réponse automatique
            const clientSocket = clients[userId];
            if (clientSocket) {
                // Détecter si on doit traduire la réponse automatique
                const userLang = userLanguages[userId] || 'FR';
                let autoReply = "Nous sommes absents pour le moment 😘. Votre message a été enregistré et nous vous répondrons dès que possible.";
                
                if (userLang !== 'FR') {
                    const translation = await translateText(autoReply, userLang, 'FR');
                    if (translation) {
                        autoReply = translation.translated;
                        console.log(`🌐 Réponse automatique traduite: FR → ${userLang}`);
                    }
                }
                
                io.to(clientSocket).emit("bot-reply", {
                    message: autoReply
                });
            }
        }
    });

    // MESSAGE ADMIN → CLIENT
    socket.on("admin-reply", async (data) => {
        const userId = String(data.userId).trim();
        const msg = data.message;
        const clientSocket = clients[userId];

        console.log(`👑 ADMIN → CLIENT ${userId} :`, msg.substring(0, 50) + "...");

        // 1. Obtenir la langue de l'utilisateur
        const userLang = userLanguages[userId] || await getUserPreferredLanguage(userId);
        let translatedMessage = null;

        // 2. Traduire si nécessaire
        if (userLang !== 'FR') {
            console.log(`🌐 Traduction admin→client nécessaire: FR → ${userLang}`);
            const translation = await translateText(msg, userLang, 'FR');
            if (translation) {
                translatedMessage = translation.translated;
                console.log(`🌐 Traduction réussie admin→client: FR → ${userLang}`);
            } else {
                console.log(`⚠️ Traduction échouée pour admin→client: FR → ${userLang}`);
            }
        }

        // 3. Stocker le message
        await storeMessage(
            userId, 'Admin', msg, 'admin', true, true,
            'FR', translatedMessage, userLang
        );
        
        // 4. Envoyer au client
        if (clientSocket) {
            const finalMessage = translatedMessage || msg;
            io.to(clientSocket).emit("chatbot-reply", {
                sender: "Support",
                message: finalMessage,
                translated: !!translatedMessage
            });
            
            console.log(`📤 Message envoyé au client ${userId} (langue: ${userLang})`);
        } else {
            console.log(`⚠️ Client ${userId} non connecté, message stocké pour plus tard`);
        }
    });

    // CHARGEMENT MESSAGES STOCKÉS
    socket.on("load-stored-messages", async () => {
        if (admins[socket.id]) {
            const allUnread = await getAllUnreadMessages();
            const unreadCount = allUnread.length;
            
            console.log(`📊 Chargement initial: ${unreadCount} messages stockés`);
            
            socket.emit("stored-messages-count", { count: unreadCount });
            
            if (unreadCount > 0) {
                const grouped = {};
                allUnread.forEach(msg => {
                    const userId = msg.user_id.toString();
                    if (!grouped[userId]) {
                        grouped[userId] = {
                            userId: userId,
                            pseudo: msg.pseudo,
                            messages: [],
                            original_messages: [],
                            languages: [],
                            count: 0
                        };
                    }
                    
                    // Utiliser le message traduit si disponible, sinon l'original
                    const displayMessage = msg.translated_message || msg.message;
                    grouped[userId].messages.push(displayMessage);
                    grouped[userId].original_messages.push(msg.message);
                    grouped[userId].languages.push(msg.original_language);
                    grouped[userId].count++;
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

    // DÉCONNEXION
    socket.on("disconnect", () => {
        console.log("❌ Déconnexion :", socket.id);

        // Enlever admin
        if (admins[socket.id]) {
            delete admins[socket.id];
            console.log("👑 Admin déconnecté");
        }

        // Enlever client
        for (let userId in clients) {
            if (clients[userId] === socket.id) {
                delete clients[userId];
                delete userLanguages[userId];
                console.log(`🙋 Client ${userId} déconnecté`);
                break;
            }
        }
    });
});

// Vérifier la connexion MySQL au démarrage
async function testDatabaseConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ Connexion MySQL établie avec succès');
        connection.release();
    } catch (error) {
        console.error('❌ Erreur connexion MySQL:', error.message);
    }
}

server.listen(4000, async () => {
    console.log("🚀 Serveur chatbot opérationnel sur le port 4000");
    
    // Tester la connexion DB
    await testDatabaseConnection();
    
    // Afficher la configuration DeepL
    if (DEEPL_API_KEY) {
        console.log('✅ DeepL API configurée');
        console.log('📝 URL:', DEEPL_API_URL);
        
        // Tester la connexion DeepL
        try {
            console.log('🔧 Test connexion DeepL...');
            const testTranslation = await translateText("Hello", "FR", "EN");
            if (testTranslation) {
                console.log('✅ DeepL fonctionne:', testTranslation);
            } else {
                console.warn('⚠️ DeepL ne répond pas correctement');
            }
        } catch (error) {
            console.error('❌ Erreur test DeepL:', error.message);
        }
    } else {
        console.warn('⚠️ DeepL API key non configurée. Mettez-la dans .env');
    }
});