import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import bodyParser from 'body-parser';
import { authenticator } from 'otplib';

// Backend Modules
import { initDb, dbPool } from './backend/database.js';
import { startHoneypots } from './backend/honeypot.js';
import apiRoutes from './backend/routes.js';
import sql from 'mssql';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 8080;
const distPath = path.join(__dirname, 'dist');

// Middleware
authenticator.options = { window: [2, 2] };
app.use(cors());
app.use(bodyParser.json({
    limit: '10mb',
    verify: (req, res, buf) => { req.rawBody = buf.toString(); }
}));

// Serve Static Files
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
}

// JSON Syntax Error Handler
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && 'body' in err) {
        console.error('❌ JSON Syntax Error');
        return res.status(400).json({ success: false, error: 'Invalid JSON payload' });
    }
    next();
});

// Initialize Systems
const init = async () => {
    await initDb();
    startHoneypots();
    
    // Wireless Recon Scheduler (2 mins)
    setInterval(async () => {
        if (!dbPool) return;
        try {
            const res = await dbPool.request().query("SELECT ActorId FROM Actors WHERE Status = 'ONLINE' AND (WifiScanningEnabled = 1 OR BluetoothScanningEnabled = 1)");
            for (const row of res.recordset) {
                const jobId = `scan-${Date.now()}-${Math.random().toString(36).substr(2,5)}`;
                await dbPool.request()
                    .input('jid', sql.NVarChar, jobId)
                    .input('aid', sql.NVarChar, row.ActorId)
                    .input('cmd', sql.NVarChar, 'vpp-agent --scan-wireless')
                    .query("INSERT INTO CommandQueue (JobId, ActorId, Command, Status, CreatedAt, UpdatedAt) VALUES (@jid, @aid, @cmd, 'PENDING', GETDATE(), GETDATE())");
            }
        } catch (e) {}
    }, 120000);
};

// Mount API Routes
app.use('/api', apiRoutes);

// Explicit API 404 Handler
app.all('/api/*', (req, res) => {
    res.status(404).json({ error: 'API Endpoint not found' });
});

// SPA Fallback
app.get('*', (req, res) => {
    if (req.accepts('html')) {
        const indexPath = path.join(distPath, 'index.html');
        if (fs.existsSync(indexPath)) res.sendFile(indexPath);
        else res.status(404).send('App not built');
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// Start Server
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on ${port}`);
    init();
});
