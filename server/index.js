// ============================================================
// ╔═══════════════════════════════════════════════════════════╗
// ║          🪙 CACAOS SYSTEM — Club Demo              ║
// ║          Sistema de Moneda Virtual Local                  ║
// ║          v1.0.0                                           ║
// ╚═══════════════════════════════════════════════════════════╝
// ============================================================
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { initializeDatabase, backupDatabase, closeDatabase, getDb } = require('./db/database');
const { seedDatabase } = require('./db/seed');

// ============================================================
// Initialize Express
// ============================================================
const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// Middleware
// ============================================================
app.use(cors());
app.use(helmet({
    contentSecurityPolicy: false,  // Allow inline scripts for admin panel
    crossOriginEmbedderPolicy: false
}));
app.use(morgan('short'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ============================================================
// Static Files (Admin Panel & POS Frontend)
// ============================================================
app.use('/admin', express.static(path.join(__dirname, '..', 'public', 'admin')));
app.use('/pos', express.static(path.join(__dirname, '..', 'public', 'pos')));
app.use('/assets', express.static(path.join(__dirname, '..', 'public', 'assets')));

// ============================================================
// API Routes
// ============================================================
const authRoutes = require('./routes/auth');
const membersRoutes = require('./routes/members');
const transactionsRoutes = require('./routes/transactions');
const terminalsRoutes = require('./routes/terminals');
const productsRoutes = require('./routes/products');
const operatorsRoutes = require('./routes/operators');
const configRoutes = require('./routes/config');
const cardsRoutes = require('./routes/cards');

app.use('/api/auth', authRoutes);
app.use('/api/members', membersRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/terminals', terminalsRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/operators', operatorsRoutes);
app.use('/api/config', configRoutes);
app.use('/api/cards', cardsRoutes);

// ============================================================
// Health Check & Root
// ============================================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        system: 'Cacaos System',
        business: 'Club Demo',
        version: '1.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Root redirect
app.get('/', (req, res) => {
    res.redirect('/admin');
});

// Admin SPA fallback
app.get('/admin/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

// POS SPA fallback
app.get('/pos/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'pos', 'index.html'));
});

// ============================================================
// 404 Handler
// ============================================================
app.use('/api/{*path}', (req, res) => {
    res.status(404).json({ error: 'Endpoint no encontrado' });
});

// ============================================================
// Error Handler
// ============================================================
app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    res.status(500).json({ error: 'Error interno del servidor' });
});

// ============================================================
// Initialize Database & Start Server
// ============================================================
try {
    const db = initializeDatabase();
    seedDatabase(db);
    
    console.log('');
    console.log('  ╔═══════════════════════════════════════════════╗');
    console.log('  ║        🪙 CACAOS SYSTEM — Starting...        ║');
    console.log('  ╚═══════════════════════════════════════════════╝');
    console.log('');

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`  🌐 Server:     http://localhost:${PORT}`);
        console.log(`  👤 Admin:      http://localhost:${PORT}/admin`);
        console.log(`  🛒 POS:        http://localhost:${PORT}/pos`);
        console.log(`  📡 API:        http://localhost:${PORT}/api/health`);
        console.log('');
        console.log('  📋 Default login:  admin / admin123');
        console.log('  📋 Vendor login:   carlos / vendor123');
        console.log('');
        console.log('  ✅ Sistema Cacaos listo para Club Demo');
        console.log('  ─────────────────────────────────────────────');
    });

    // ============================================================
    // Scheduled Backup (every 24 hours)
    // ============================================================
    setInterval(() => {
        console.log('[BACKUP] Running scheduled backup...');
        backupDatabase();
    }, 24 * 60 * 60 * 1000); // 24 hours

    // Also backup on start
    setTimeout(() => backupDatabase(), 5000);

    // ============================================================
    // Terminal Auditor Daemon
    // ============================================================
    setInterval(() => {
        try {
            const dbRef = getDb();
            if (!dbRef) return;
            
            // Logically offline terminals: active terminals with no heartbeat in past 60s
            const offlineTerminals = dbRef.prepare(`
                SELECT id, name FROM terminals 
                WHERE status = 'active'
                AND (last_heartbeat IS NULL OR last_heartbeat < datetime('now', '-60 seconds'))
            `).all();

            // Find terminals that already have a recent 'offline' event so we don't spam
            // We only care if the LATEST event is 'offline'.
            for (let t of offlineTerminals) {
                const latestEvent = dbRef.prepare(`
                    SELECT event_type FROM terminal_events 
                    WHERE terminal_id = ? 
                    ORDER BY created_at DESC LIMIT 1
                `).get(t.id);

                if (!latestEvent || latestEvent.event_type !== 'offline') {
                    dbRef.prepare(`
                        INSERT INTO terminal_events (terminal_id, event_type, message) 
                        VALUES (?, 'offline', 'Pérdida de conexión (Timeout 60s)')
                    `).run(t.id);
                }
            }

            // Also check terminals that just came back online (they have heartbeat)
            const onlineTerminals = dbRef.prepare(`
                SELECT id, name FROM terminals 
                WHERE status = 'active'
                AND last_heartbeat >= datetime('now', '-60 seconds')
            `).all();

            for (let t of onlineTerminals) {
                const latestEvent = dbRef.prepare(`
                    SELECT event_type FROM terminal_events 
                    WHERE terminal_id = ? 
                    ORDER BY created_at DESC LIMIT 1
                `).get(t.id);

                if (latestEvent && latestEvent.event_type === 'offline') {
                    dbRef.prepare(`
                        INSERT INTO terminal_events (terminal_id, event_type, message) 
                        VALUES (?, 'online', 'Conexión recuperada')
                    `).run(t.id);
                }
            }
        } catch(e) {
            console.error('[DAEMON] Error auditing terminals:', e);
        }
    }, 15000); // Check every 15 seconds

} catch (err) {
    console.error('❌ Failed to start Cacaos System:', err);
    process.exit(1);
}

// ============================================================
// Graceful Shutdown
// ============================================================
process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN] Closing Cacaos System...');
    closeDatabase();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n[SHUTDOWN] Closing Cacaos System...');
    closeDatabase();
    process.exit(0);
});

module.exports = app;
