// ============================================================
// CACAOS SYSTEM — Database Seed Data
// ============================================================

const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

function seedDatabase(db) {
    const hasAdmin = db.prepare('SELECT COUNT(*) as count FROM operators WHERE role = ?').get('admin');
    
    if (hasAdmin.count > 0) {
        console.log('[SEED] Database already seeded, skipping...');
        return;
    }

    console.log('[SEED] Seeding database with initial data...');

    // ---- Config ----
    const configInsert = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
    const configs = [
        ['business_name', 'Club Demo'],
        ['exchange_rate', '10'],           // 1 cacao = $10 MXN
        ['currency_name', 'Cacaos'],
        ['currency_symbol', '🪙'],
        ['require_pin_above', '0'],        // 0 = never require PIN
        ['lock_duration_seconds', '5'],    // anti-double-charge window
        ['backup_enabled', 'true'],
        ['backup_interval_hours', '24'],
    ];
    
    const seedConfig = db.transaction(() => {
        for (const [key, value] of configs) {
            configInsert.run(key, value);
        }
    });
    seedConfig();
    console.log('[SEED] Config values set');

    // ---- Admin Operator ----
    const adminPassword = bcrypt.hashSync('admin123', 10);
    db.prepare(`
        INSERT INTO operators (username, password_hash, role, full_name)
        VALUES (?, ?, ?, ?)
    `).run('admin', adminPassword, 'admin', 'Administrador Principal');
    console.log('[SEED] Admin operator created (user: admin, pass: admin123)');

    // ---- Demo Vendors ----
    const vendorPassword = bcrypt.hashSync('vendor123', 10);
    const vendors = [
        ['carlos', 'Carlos Mendoza'],
        ['ana', 'Ana López'],
        ['pedro', 'Pedro Ramírez']
    ];
    
    const vendorInsert = db.prepare(`
        INSERT INTO operators (username, password_hash, role, full_name)
        VALUES (?, ?, 'vendor', ?)
    `);
    
    const seedVendors = db.transaction(() => {
        for (const [username, name] of vendors) {
            vendorInsert.run(username, vendorPassword, name);
        }
    });
    seedVendors();
    console.log('[SEED] Demo vendors created');

    // ---- Demo Terminals ----
    const terminalInsert = db.prepare(`
        INSERT INTO terminals (name, token, location)
        VALUES (?, ?, ?)
    `);
    
    const terminals = [
        ['Barra de Bebidas', uuidv4(), 'Planta baja, junto a la entrada'],
        ['Restaurante', uuidv4(), 'Segundo piso, área de comedor'],
        ['Tienda', uuidv4(), 'Planta baja, pasillo principal']
    ];
    
    const seedTerminals = db.transaction(() => {
        for (const [name, token, location] of terminals) {
            terminalInsert.run(name, token, location);
        }
    });
    seedTerminals();
    console.log('[SEED] Demo terminals created');

    // ---- Demo Members ----
    const memberInsert = db.prepare(`
        INSERT INTO members (member_code, full_name, phone, balance)
        VALUES (?, ?, ?, ?)
    `);

    const members = [
        ['CAC-0001', 'María García', '555-1234', 450],
        ['CAC-0002', 'Roberto López', '555-5678', 120],
        ['CAC-0003', 'Ana Martínez', '555-9012', 0],
        ['CAC-0004', 'Pedro Sánchez', '555-3456', 890],
        ['CAC-0005', 'Laura Hernández', '555-7890', 250],
    ];

    const seedMembers = db.transaction(() => {
        for (const [code, name, phone, balance] of members) {
            memberInsert.run(code, name, phone, balance);
        }
    });
    seedMembers();
    console.log('[SEED] Demo members created');

    // ---- Demo Cards (simulated NFC) ----
    const cardInsert = db.prepare(`
        INSERT INTO cards (member_id, card_uid, account_token, counter)
        VALUES (?, ?, ?, ?)
    `);

    const seedCards = db.transaction(() => {
        for (let i = 1; i <= 5; i++) {
            const uid = `NFC-SIM-${String(i).padStart(4, '0')}`;
            const token = uuidv4();
            cardInsert.run(i, uid, token, 0);
        }
    });
    seedCards();
    console.log('[SEED] Demo NFC cards assigned');

    // ---- Demo Products ----
    const productInsert = db.prepare(`
        INSERT INTO products (terminal_id, name, price, category)
        VALUES (?, ?, ?, ?)
    `);

    const products = [
        // Barra de Bebidas (terminal 1)
        [1, 'Cerveza Artesanal', 15, 'Bebidas'],
        [1, 'Cóctel Margarita', 25, 'Bebidas'],
        [1, 'Agua Mineral', 5, 'Bebidas'],
        [1, 'Refresco', 8, 'Bebidas'],
        [1, 'Shot Tequila', 12, 'Bebidas'],
        [1, 'Cerveza Nacional', 10, 'Bebidas'],
        // Restaurante (terminal 2)
        [2, 'Nachos Supremos', 18, 'Snacks'],
        [2, 'Hamburguesa Clásica', 30, 'Comida'],
        [2, 'Tacos (3 pzas)', 20, 'Comida'],
        [2, 'Alitas BBQ', 22, 'Comida'],
        [2, 'Ensalada César', 15, 'Comida'],
        [2, 'Papas Fritas', 10, 'Snacks'],
        // Tienda (terminal 3)
        [3, 'Playera del Club', 50, 'Merch'],
        [3, 'Gorra Demo', 35, 'Merch'],
        [3, 'Llavero', 8, 'Merch'],
        [3, 'Póster Evento', 15, 'Merch'],
    ];

    const seedProducts = db.transaction(() => {
        for (const [tid, name, price, cat] of products) {
            productInsert.run(tid, name, price, cat);
        }
    });
    seedProducts();
    console.log('[SEED] Demo products created');

    console.log('[SEED] ✅ Database seeded successfully!');
}

module.exports = { seedDatabase };
