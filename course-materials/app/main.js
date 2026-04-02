const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let serverProcess;
const SERVER_PORT = 3000;

// Check if port is available
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const net = require('net');
        const server = net.createServer();

        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false);
            } else {
                resolve(false);
            }
        });

        server.once('listening', () => {
            server.close();
            resolve(true);
        });

        server.listen(port, '127.0.0.1');
    });
}

// Start the Express server
async function startServer() {
    return new Promise(async (resolve, reject) => {
        // Check if port is already in use
        const portAvailable = await isPortAvailable(SERVER_PORT);
        if (!portAvailable) {
            console.log(`Port ${SERVER_PORT} already in use, assuming server is running`);
            resolve();
            return;
        }

        const serverPath = path.join(__dirname, 'server', 'server.js');

        // Start the server process
        serverProcess = spawn('node', [serverPath], {
            stdio: 'pipe',
            env: { ...process.env, PORT: SERVER_PORT }
        });

        serverProcess.stdout.on('data', (data) => {
            console.log(`Server: ${data}`);
            if (data.toString().includes('Server running')) {
                resolve();
            }
        });

        serverProcess.stderr.on('data', (data) => {
            console.error(`Server Error: ${data}`);
        });

        serverProcess.on('close', (code) => {
            console.log(`Server process exited with code ${code}`);
        });

        // Timeout after 10 seconds
        setTimeout(() => {
            resolve();
        }, 10000);
    });
}

// Create the main window
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 600,
        backgroundColor: '#f5f5f7',
        titleBarStyle: 'hiddenInset', // macOS-style title bar
        frame: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            webSecurity: true
        },
        icon: path.join(__dirname, 'public', 'assets', 'icon.png')
    });

    // Load the app
    mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);

    // Open DevTools in development mode (comment out for production)
    // mainWindow.webContents.openDevTools();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Handle external links
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        // Prevent opening external links
        if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
            return { action: 'allow' };
        }
        return { action: 'deny' };
    });
}

// Wait for server to be ready
async function waitForServer(maxAttempts = 30) {
    const http = require('http');

    for (let i = 0; i < maxAttempts; i++) {
        try {
            await new Promise((resolve, reject) => {
                const req = http.get(`http://localhost:${SERVER_PORT}`, (res) => {
                    resolve();
                });
                req.on('error', reject);
                req.setTimeout(1000);
            });
            return true;
        } catch (e) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }
    return false;
}

// App lifecycle
app.whenReady().then(async () => {
    try {
        // Start the Express server
        await startServer();

        // Wait for server to be ready
        const serverReady = await waitForServer();

        if (!serverReady) {
            dialog.showErrorBox('Server Error', 'Failed to start the application server. Please try again.');
            app.quit();
            return;
        }

        // Create the window
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    } catch (error) {
        console.error('Failed to start application:', error);
        dialog.showErrorBox('Startup Error', `Failed to start application: ${error.message}`);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    // Kill the server process
    if (serverProcess) {
        serverProcess.kill();
    }

    // On macOS, keep app running
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    // Kill the server process
    if (serverProcess) {
        serverProcess.kill();
    }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    dialog.showErrorBox('Error', `An error occurred: ${error.message}`);
});
