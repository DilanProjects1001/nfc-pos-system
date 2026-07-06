// ============================================================
// CACAOS SYSTEM — JWT Authentication Middleware
// ============================================================

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('CRITICAL ERROR: JWT_SECRET environment variable is not set. Terminating.');
    process.exit(1);
}
const JWT_EXPIRY = '24h';

/**
 * Generate a JWT token for an operator
 */
function generateToken(operator) {
    return jwt.sign(
        {
            id: operator.id,
            username: operator.username,
            role: operator.role,
            full_name: operator.full_name
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
    );
}

/**
 * Middleware: Require authentication
 */
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de autenticación requerido' });
    }

    const token = authHeader.split(' ')[1];
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.operator = decoded;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expirado, inicie sesión de nuevo' });
        }
        return res.status(401).json({ error: 'Token inválido' });
    }
}

/**
 * Middleware: Require admin role
 */
function requireAdmin(req, res, next) {
    if (req.operator.role !== 'admin') {
        return res.status(403).json({ error: 'Se requiere rol de administrador' });
    }
    next();
}

/**
 * Middleware: Require either admin or vendor role
 */
function requireOperator(req, res, next) {
    if (!['admin', 'vendor'].includes(req.operator.role)) {
        return res.status(403).json({ error: 'Acceso no autorizado' });
    }
    next();
}

module.exports = {
    generateToken,
    requireAuth,
    requireAdmin,
    requireOperator,
    JWT_SECRET
};
