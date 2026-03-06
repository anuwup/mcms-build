const jwt = require('jsonwebtoken');

const protect = (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'mcms_super_secret_key');
            req.user = decoded;
            return next(); // <-- return here to stop execution falling through
        } catch (error) {
            console.error('Token verification failed:', error.message);
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }

    // Only reaches here if no token was found
    return res.status(401).json({ message: 'Not authorized, no token' });
};

module.exports = { protect };
