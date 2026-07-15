const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// Initialize SQLite Database in memory
const db = new sqlite3.Database(':memory:', (err) => {
    if (err) return console.error(err.message);
    console.log('Connected to the in-memory SQLite database.');
});

// Create Inventory Table
db.serialize(() => {
    db.run(`CREATE TABLE inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        sku_size TEXT,
        category TEXT DEFAULT 'Surgical Instruments',
        quantity INTEGER DEFAULT 0,
        price REAL DEFAULT 0.0,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed data for surgical items with prices
    db.run(`INSERT INTO inventory (name, sku_size, category, quantity, price) VALUES 
        ('Scalpel Blades', 'Size 10', 'Surgical Instruments', 120, 1.50),
        ('Sterile Gloves', 'Size 7.5', 'Protective Gear', 450, 4.50),
        ('Orthopedic Bone Saws', 'Standard', 'Surgical Equipment', 12, 350.00)`);
});

// Helper function to format strings to Title Case
function toTitleCase(str) {
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

// API: Get all inventory items
app.get('/api/inventory', (req, res) => {
    db.all("SELECT * FROM inventory ORDER BY last_updated DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// API: Add new item manually
app.post('/api/inventory', (req, res) => {
    const { name, sku_size, category, quantity, price } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'Item name is required' });
    }
    const cleanName = toTitleCase(name.trim());
    const cleanSize = sku_size ? sku_size.trim() : 'Standard';
    const cleanCat = category ? toTitleCase(category.trim()) : 'Surgical Instruments';
    const qty = parseInt(quantity) || 0;
    const prc = parseFloat(price) || 0.0;

    // Check if duplicate exists
    db.get("SELECT * FROM inventory WHERE LOWER(name) = ? AND LOWER(sku_size) = ?", [cleanName.toLowerCase(), cleanSize.toLowerCase()], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            return res.status(400).json({ error: `An item named "${cleanName}" with size "${cleanSize}" already exists.` });
        }
        
        db.run(
            `INSERT INTO inventory (name, sku_size, category, quantity, price, last_updated) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [cleanName, cleanSize, cleanCat, qty, prc],
            function (insertErr) {
                if (insertErr) return res.status(500).json({ error: insertErr.message });
                res.status(201).json({ id: this.lastID, name: cleanName, sku_size: cleanSize, category: cleanCat, quantity: qty, price: prc });
            }
        );
    });
});

// API: Update item quantity and price manually
app.put('/api/inventory/:id', (req, res) => {
    const { quantity, price } = req.body;
    const { id } = req.params;
    const qty = parseInt(quantity);
    const prc = parseFloat(price);

    if (isNaN(qty) || qty < 0) {
        return res.status(400).json({ error: 'Valid quantity is required' });
    }
    if (isNaN(prc) || prc < 0) {
        return res.status(400).json({ error: 'Valid price is required' });
    }

    db.run(
        `UPDATE inventory SET quantity = ?, price = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
        [qty, prc, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Item not found' });
            }
            res.json({ success: true, message: `Updated quantity to ${qty} and price to INR ₹${prc.toFixed(2)}.` });
        }
    );
});

// API: Delete an item
app.delete('/api/inventory/:id', (req, res) => {
    const { id } = req.params;
    db.run("DELETE FROM inventory WHERE id = ?", [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Item not found' });
        }
        res.json({ success: true, message: 'Item deleted successfully.' });
    });
});

// Helper function to normalize Hinglish to English
function normalizeHinglish(msg) {
    let text = msg.toLowerCase().trim();
    text = text.replace(/[\?!\.]*$/, '').trim();

    // 1. ADD PATTERNS (Hinglish additions)
    const addRegex = /\s+(?:add\s+karo|add\s+kardo|add\s+do|badha\s+do|badhao|daal\s+do|daalo|dalo|stock\s+me\s+daalo|stock\s+me\s+dalo|stock\s+mein\s+daalo|stock\s+mein\s+dalo|increase\s+karo|plus\s+karo|plus\s+kardo|mil\s+gaye|aaye\s+hain|aaye\s+he)$/;
    if (/^\d+/.test(text) && addRegex.test(text)) {
        return 'add ' + text.replace(addRegex, '').trim();
    }

    // 2. REMOVE PATTERNS (Hinglish removals)
    const removeRegex = /\s+(?:remove\s+karo|remove\s+kardo|nikal\s+do|nikalo|kam\s+karo|kam\s+kardo|minus\s+karo|minus\s+kardo|deduct\s+karo|deduct\s+kardo|sold\s+karo|becha)$/;
    if (/^\d+/.test(text) && removeRegex.test(text)) {
        return 'remove ' + text.replace(removeRegex, '').trim();
    }

    // 3. QUERY PATTERNS (Ends with Hinglish query phrase)
    const queryEndRegex = /\s+(?:kitne\s+hain|kitna\s+hai|kitne\s+he|kitna\s+he|kitne\s+hai|check\s+karo|check\s+kardo|show\s+karo|show\s+kardo|dikhao|batao|bata)$/;
    if (queryEndRegex.test(text)) {
        return 'how many ' + text.replace(queryEndRegex, '').trim();
    }

    // 4. QUERY PATTERNS (Starts with Hinglish query phrase like "kitne", "kitna")
    if (text.startsWith('kitne ') || text.startsWith('kitna ')) {
        text = text.replace(/^(kitne|kitna)\s+(?:stock\s+hai\s+of\s+|stock\s+he\s+of\s+|stock\s+hai\s+|stock\s+he\s+|stock\s+)?/, 'how many ');
        text = text.replace(/\s+(?:hain|hai|he|stock\s+hai|stock\s+he|ka\s+stock|ka|ko|se)$/, '').trim();
        return text;
    }

    // 5. PDF PATTERNS (Hinglish PDF generation request)
    if (/(?:pdf|report|catalog|catalogue)/.test(text)) {
        if (/(?:banao|nikalo|generate|download|show|dikhao|show\s+karo)/.test(text)) {
            return 'generate pdf';
        }
    }

    return text;
}

// API: Process Natural Language Chat
app.post('/api/chat', (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });
    
    // 1. Clean and normalize text
    let text = message.toLowerCase().trim();
    
    // Replace Devnagari digits to standard digits
    const devnagariDigits = {
        '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
        '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
    };
    text = text.replace(/[०-९]/g, d => devnagariDigits[d]);

    // Extract price if specified (e.g. "at 12" or "price 150" or "at price 6.00")
    const priceRegex = /(?:at\s+)?(price|rate|cost|val|value|rate\s+of|price\s+of|at|कीमत|दाम|रेट)\s*(?:\$|rs\.?|rupees|₹)?\s*(\d+(?:\.\d+)?)/i;
    const priceMatch = text.match(priceRegex);
    const chatPrice = priceMatch ? parseFloat(priceMatch[2]) : null;
    if (priceMatch) {
        text = text.replace(priceMatch[0], '').replace(/\s+/g, ' ').trim();
    }

    // Extract size if specified (e.g., "size 7.5", "size 10", "no 10", "no. 10")
    const sizeRegex = /(?:size|no\.?|number|साइज|नंबर|न०|माप)\s*([\w\d.-]+)/i;
    const sizeMatch = text.match(sizeRegex);
    let size = sizeMatch ? sizeMatch[1].trim() : null;
    if (sizeMatch) {
        text = text.replace(sizeMatch[0], '').replace(/\s+/g, ' ').trim();
    }

    // Extract quantity (any remaining number in the query)
    const qtyRegex = /\b(\d+)\b/;
    const qtyMatch = text.match(qtyRegex);
    let qty = qtyMatch ? parseInt(qtyMatch[1]) : null;
    if (qtyMatch) {
        text = text.replace(qtyMatch[0], '').replace(/\s+/g, ' ').trim();
    }

    // Detect action based on keywords
    let action = null;
    
    const addKeywords = [
        'add', 'received', 'plus', 'increase', 'stock', 'badha', 'badhao', 'daal', 'daalo', 'dalo', 'mil', 'aaye', 'jod', 'jodo', 'jama', 
        'ऐड', 'एड', 'जोड़', 'जोड़ो', 'बढ़ा', 'बढ़ाओ', 'डाल', 'डालो', 'मिला', 'मिले', 'आए', 'जमा'
    ];
    
    const removeKeywords = [
        'remove', 'sold', 'minus', 'take', 'decrease', 'deduct', 'nikal', 'nikalo', 'kam', 'becha', 'ghata', 'ghatao',
        'घटा', 'घटाओ', 'निकाल', 'निकालो', 'कम', 'बेचा'
    ];
    
    const queryKeywords = [
        'how many', 'how much', 'show', 'check', 'find', 'status', 'inventory', 'kitna', 'kitne', 'dikhao', 'batao', 'bata', 'khojo', 'dhundho', 'hai', 'he',
        'कितना', 'कितने', 'दिखाओ', 'बताओ', 'चेक', 'खोजो', 'ढूंढो', 'है'
    ];

    const pdfKeywords = [
        'pdf', 'report', 'catalog', 'catalogue', 'पीडीऍफ़', 'रिपोर्ट'
    ];

    // Clean text of common punctuation and trim
    text = text.replace(/[\?!\.,]*$/, '').trim();

    if (pdfKeywords.some(kw => text.includes(kw))) {
        action = 'pdf';
    } else if (addKeywords.some(kw => new RegExp('\\b' + kw + '\\b|' + kw, 'i').test(text))) {
        action = 'add';
    } else if (removeKeywords.some(kw => new RegExp('\\b' + kw + '\\b|' + kw, 'i').test(text))) {
        action = 'remove';
    } else if (queryKeywords.some(kw => new RegExp('\\b' + kw + '\\b|' + kw, 'i').test(text)) || text.startsWith('what') || text.startsWith('check')) {
        action = 'query';
    } else {
        // Fallback
        if (qty !== null) {
            action = 'add'; 
        } else {
            action = 'query'; 
        }
    }

    // Clean action keywords and filler words from the remaining text to get the item name
    let cleanText = text;
    const allKeywords = [
        ...addKeywords, ...removeKeywords, ...queryKeywords, ...pdfKeywords, 
        'karo', 'kardo', 'kar', 'do', 'please', 'ko', 'se', 'ka', 'ke', 'mein', 'me', 'in', 'of', 'for', 'to', 
        'करो', 'कर', 'दो', 'को', 'से', 'का', 'के', 'में'
    ];
    
    allKeywords.forEach(kw => {
        const isEnglish = /^[a-z0-9]+$/i.test(kw);
        const regex = isEnglish ? new RegExp('\\b' + kw + '\\b', 'gi') : new RegExp(kw, 'g');
        cleanText = cleanText.replace(regex, '');
    });
    
    cleanText = cleanText.replace(/\s+/g, ' ').trim();

    // Map common Hindi/Devnagari and Hinglish translations to database items
    const translationMap = {
        'दस्ताने': 'sterile gloves',
        'ग्लव्स': 'sterile gloves',
        'स्टेराइल ग्लव्स': 'sterile gloves',
        'dastane': 'sterile gloves',
        'gloves': 'sterile gloves',
        'glove': 'sterile gloves',
        
        'ब्लेड': 'scalpel blades',
        'ब्लेड्स': 'scalpel blades',
        'स्केल्पेल': 'scalpel blades',
        'स्केल्पेल ब्लेड्स': 'scalpel blades',
        'blade': 'scalpel blades',
        'blades': 'scalpel blades',
        
        'आरी': 'orthopedic bone saws',
        'बोन सॉ': 'orthopedic bone saws',
        'हड्डी की आरी': 'orthopedic bone saws',
        'ऑर्थोपेडिक': 'orthopedic bone saws',
        'saw': 'orthopedic bone saws',
        'saws': 'orthopedic bone saws',
        
        'गाउन': 'surgical gowns',
        'गाउन्स': 'surgical gowns',
        'gown': 'surgical gowns',
        'gowns': 'surgical gowns',
        
        'टांके': 'suture nylon',
        'सूचर': 'suture nylon',
        'suture': 'suture nylon',
        'sutures': 'suture nylon'
    };

    let matchedItemName = cleanText;
    // Check translation map
    for (const [key, value] of Object.entries(translationMap)) {
        if (cleanText.includes(key) || key.includes(cleanText)) {
            matchedItemName = value;
            break;
        }
    }

    if (!matchedItemName && cleanText) {
        matchedItemName = cleanText;
    }

    // 0. PDF COMMAND CASE
    if (action === 'pdf') {
        return res.json({ response: "Here is your generated PDF Catalog:", isPdfCommand: true });
    }

    if (!matchedItemName) {
        let responseText = "I couldn't identify the surgical item name in your command.\n\n" +
                           "**Try some of these examples:**\n" +
                           "- `Add 10 Scalpel Blades size 10`\n" +
                           "- `Remove 5 Sterile Gloves size 7.5`\n" +
                           "- `How many Orthopedic Bone Saws do we have?`\n" +
                           "- `10 gloves add karo` / `5 blades nikal do`";
        return res.json({ response: responseText });
    }

    // 1. QUERY CASE
    if (action === 'query') {
        let sql = "SELECT * FROM inventory WHERE LOWER(name) LIKE ?";
        let params = [`%${matchedItemName}%`];
        
        if (size) {
            sql += " AND LOWER(sku_size) LIKE ?";
            params.push(`%${size}%`);
        }

        db.all(sql, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            if (rows.length === 0) {
                return res.json({ response: `Could not find any items matching "${toTitleCase(matchedItemName)}"${size ? ` with size "${size}"` : ''} in inventory.`, items: [] });
            }
            if (rows.length === 1) {
                const item = rows[0];
                return res.json({ response: `We currently have **${item.quantity}** units of **${item.name}** (${item.sku_size}) in "${item.category}". Price is **INR ₹${item.price.toFixed(2)}**.`, items: rows });
            }
            // Multiple matches
            let listStr = rows.map(r => `- **${r.name}** (${r.sku_size}): **${r.quantity}** units [Price: INR ₹${r.price.toFixed(2)}]`).join('\n');
            return res.json({ response: `I found multiple matching items:\n${listStr}`, items: rows });
        });
        return;
    }

    // 2. ADD CASE
    if (action === 'add') {
        if (qty === null) qty = 1; // Default to 1
        let formattedSize = 'Standard';
        if (size) {
            // Check if size is just a number (like 10 or 7.5), if so, prepend "Size "
            formattedSize = /^\d+(\.\d+)?$/.test(size) ? `Size ${size}` : toTitleCase(size);
        }

        const cleanName = toTitleCase(matchedItemName);
        const cleanCat = 'Surgical Instruments'; // Default category

        db.get(
            `SELECT * FROM inventory WHERE LOWER(name) = ? AND LOWER(sku_size) = ?`,
            [cleanName.toLowerCase(), formattedSize.toLowerCase()],
            (err, row) => {
                if (err) return res.status(500).json({ error: err.message });
                
                if (row) {
                    const newPrice = chatPrice !== null ? chatPrice : row.price;
                    db.run(
                        `UPDATE inventory SET quantity = quantity + ?, price = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
                        [qty, newPrice, row.id],
                        function(updateErr) {
                            if (updateErr) return res.status(500).json({ error: updateErr.message });
                            const updatedRow = { ...row, quantity: row.quantity + qty, price: newPrice, last_updated: new Date().toISOString() };
                            res.json({ response: `Successfully added **${qty}** units to existing item **${row.name}** (${row.sku_size}) at price **INR ₹${newPrice.toFixed(2)}**. New total: **${row.quantity + qty}**.`, items: [updatedRow], txnType: 'add', txnQty: qty });
                        }
                    );
                } else {
                    const newPrice = chatPrice !== null ? chatPrice : 15.00;
                    db.run(
                        `INSERT INTO inventory (name, sku_size, category, quantity, price, last_updated) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                        [cleanName, formattedSize, cleanCat, qty, newPrice],
                        function(insertErr) {
                            if (insertErr) return res.status(500).json({ error: insertErr.message });
                            const newRow = { id: this.lastID, name: cleanName, sku_size: formattedSize, category: cleanCat, quantity: qty, price: newPrice, last_updated: new Date().toISOString() };
                            res.json({ response: `Successfully created new item: **${cleanName}** (${formattedSize}) with **${qty}** units at price **INR ₹${newPrice.toFixed(2)}** in category "${cleanCat}".`, items: [newRow], txnType: 'add', txnQty: qty });
                        }
                    );
                }
            }
        );
        return;
    }

    // 3. REMOVE CASE
    if (action === 'remove') {
        if (qty === null) qty = 1; // Default to 1
        
        let sql = "SELECT * FROM inventory WHERE LOWER(name) LIKE ?";
        let params = [`%${matchedItemName}%`];
        
        if (size) {
            sql += " AND LOWER(sku_size) LIKE ?";
            params.push(`%${size}%`);
        }

        db.all(sql, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            if (rows.length === 0) {
                return res.json({ response: `Could not find any items matching "${toTitleCase(matchedItemName)}"${size ? ` with size "${size}"` : ''} to remove.`, items: [] });
            }
            if (rows.length > 1) {
                let listStr = rows.map(r => `- **${r.name}** (${r.sku_size})`).join('\n');
                return res.json({ response: `Multiple items match your query. Please specify size:\n${listStr}`, items: rows });
            }

            const item = rows[0];
            const newQty = Math.max(0, item.quantity - qty);
            
            db.run(
                `UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
                [newQty, item.id],
                function(updateErr) {
                    if (updateErr) return res.status(500).json({ error: updateErr.message });
                    const updatedRow = { ...item, quantity: newQty, last_updated: new Date().toISOString() };
                    res.json({ response: `Successfully deducted **${qty}** units from **${item.name}** (${item.sku_size}). New total: **${newQty}**.`, items: [updatedRow], txnType: 'remove', txnQty: qty });
                }
            );
        });
        return;
    }

    // Fallback error
    let responseText = "I couldn't quite understand that command.\n\n" +
                       "**Try some of these examples:**\n" +
                       "- `Add 10 Scalpel Blades size 10`\n" +
                       "- `Remove 5 Sterile Gloves size 7.5`\n" +
                       "- `How many Orthopedic Bone Saws do we have?`\n" +
                       "- `10 gloves add karo` / `5 blades nikal do`\n" +
                       "- `gloves kitne hai` / `ब्लेड कितने है`\n" +
                       "- `pdf banao` / `report generate karo`";
                       
    res.json({ response: responseText });
});

app.listen(3000, () => console.log('Surgical Inventory Server running on http://localhost:3000'));
