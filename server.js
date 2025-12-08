import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import bodyParser from 'body-parser';
import apiRoutes from './backend/routes.js';
import { initDb } from './backend/database.js';
import { startHoneypots } from './backend/honeypot.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;
const distPath = path.join(__dirname, 'dist');

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Global JSON Error Handler to prevent crashes on malformed requests
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.error(`[API] JSON Parse Error from ${req.ip}: ${err.message}`);
        return res.status(400).json({ error: 'Malformed JSON payload' });
    }
    next();
});

// Initialize Backend Services
console.log('--- STARTING VIRTUAL PUPPETS C2 ---');
initDb().then(() => {
    console.log('-> Database Subsystem Initialized');
}).catch(err => {
    console.error('-> Database Init Failed:', err.message);
});

startHoneypots();

// Mount API Routes
app.use('/api', apiRoutes);

// Serve Frontend Static Files
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    
    // SPA Fallback for non-API routes
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api')) {
            res.sendFile(path.join(distPath, 'index.html'));
        } else {
            res.status(404).json({ error: 'API Endpoint not found' });
        }
    });
} else {
    console.log('-> Frontend build not found in /dist. Running in API-only mode.');
    app.get('/', (req, res) => res.send('Virtual Puppets C2 API Server Running'));
}

// Start Server
app.listen(port, '0.0.0.0', () => {
    console.log(`-> Server listening on port ${port}`);
});