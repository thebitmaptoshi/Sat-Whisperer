#!/usr/bin/env node

import https from 'https';
import http from 'http';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ESM equivalents for __filename and __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Utility helpers
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ANSI color codes
const colors = {
    yellow: '\x1b[33m',
    reset: '\x1b[0m',
    bright: '\x1b[1m'
};

// Utility function to display sat numbers in formatted columns with yellow color
function displaySatNumbers(satNumbers, blockHeight) {
    if (!satNumbers || satNumbers.length === 0) {
        console.log(`${colors.yellow}${colors.bright}\nBlock ${blockHeight} - No sat numbers found in this block.${colors.reset}`);
        return;
    }

    // Sort the numbers
    const sortedSats = [...satNumbers].sort((a, b) => a - b);

    // Calculate the maximum width needed for any sat number
    const maxWidth = Math.max(...sortedSats.map(sat => sat.toString().length));
    const columnWidth = Math.max(maxWidth + 3, 15); // Minimum width of 15 for readability

    console.log(`${colors.yellow}${colors.bright}\nBlock ${blockHeight} - Sat Numbers Found (${sortedSats.length} total):${colors.reset}`);

    // Determine number of columns and rows
    const maxColumns = 5;
    const maxPerColumn = 25;
    const totalCount = sortedSats.length;

    let columns, rows;

    if (totalCount <= maxPerColumn) {
        // Single column if 25 or fewer
        columns = 1;
        rows = totalCount;
    } else {
        // Calculate optimal column distribution
        columns = Math.min(maxColumns, Math.ceil(totalCount / maxPerColumn));
        rows = Math.ceil(totalCount / columns);

        // Distribute items evenly across columns
        // If we have remainder, distribute extra items to first columns
        const baseItemsPerColumn = Math.floor(totalCount / columns);
        const extraItems = totalCount % columns;
    }

    // Create 2D array to hold the distributed numbers
    const grid = [];
    for (let col = 0; col < columns; col++) {
        grid[col] = [];
    }

    // Distribute numbers vertically (fill columns one by one)
    let currentIndex = 0;
    for (let col = 0; col < columns && currentIndex < totalCount; col++) {
        const itemsInThisColumn = Math.floor(totalCount / columns) + (col < (totalCount % columns) ? 1 : 0);

        for (let row = 0; row < itemsInThisColumn && currentIndex < totalCount; row++) {
            grid[col][row] = sortedSats[currentIndex];
            currentIndex++;
        }
    }

    // Find the maximum rows needed
    const maxRows = Math.max(...grid.map(col => col.length));

    // Print the grid
    for (let row = 0; row < maxRows; row++) {
        const rowData = [];
        for (let col = 0; col < columns; col++) {
            if (grid[col] && grid[col][row] !== undefined) {
                const satStr = grid[col][row].toString();
                rowData.push(satStr.padEnd(columnWidth));
            } else {
                rowData.push(''.padEnd(columnWidth));
            }
        }
        console.log(`${colors.yellow}${rowData.join('')}${colors.reset}`);
    }
}

// Add this fetch implementation for Node.js ESM
function fetch(url) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const client = urlObj.protocol === 'https:' ? https : http;

        const req = client.request(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    status: res.statusCode,
                    headers: {
                        get: (name) => res.headers[name.toLowerCase()]
                    },
                    text: () => Promise.resolve(data),
                    json: () => Promise.resolve(JSON.parse(data))
                });
            });
        });

        req.on('error', reject);
        req.setTimeout(30000);
        req.end();
    });
}

// WebSocket configuration for mempool.space
const WEBSOCKET_ENDPOINTS = [
    'wss://mempool.space/api/v1/ws',
    // Add more backup endpoints if needed
];
let currentWSEndpoint = 0;
let blockWebSocket = null;
let wsReconnectTimer = null;
const WS_RECONNECT_DELAY = 5000;
const MAX_WS_RECONNECT_ATTEMPTS = 5;
let wsReconnectAttempts = 0;
let isConnecting = false;
let isDebugMode = false;

// Global monitoring state
let monitoringState = {
    startTime: Date.now(),
    totalBlocksProcessed: 0,
    totalInscriptionsChecked: 0,
    lastProcessedBlock: null
};

// Logging function
async function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] ${message}`);
}

// WebSocket connection function
async function connectBlockWebSocket() {
    if (isConnecting || (blockWebSocket && blockWebSocket.readyState === WebSocket.CONNECTING)) return;

    if (wsReconnectAttempts >= MAX_WS_RECONNECT_ATTEMPTS) {
        currentWSEndpoint = (currentWSEndpoint + 1) % WEBSOCKET_ENDPOINTS.length;
        wsReconnectAttempts = 0;

        if (currentWSEndpoint === 0) {
            await log(`All WebSocket endpoints failed. Switching to polling mode.`, 'ERROR');
            await startPollingMode();
            return;
        }

        await log(`Switching to WebSocket endpoint ${currentWSEndpoint + 1}/${WEBSOCKET_ENDPOINTS.length}: ${WEBSOCKET_ENDPOINTS[currentWSEndpoint]}`, 'INFO');
    }

    isConnecting = true;
    const wsUrl = WEBSOCKET_ENDPOINTS[currentWSEndpoint];

    try {
        await log(`Connecting to WebSocket (${wsUrl}) for real-time block notifications... (attempt ${wsReconnectAttempts + 1})`);

        if (blockWebSocket) {
            blockWebSocket.removeAllListeners();
            if (blockWebSocket.readyState === WebSocket.OPEN) blockWebSocket.close();
            blockWebSocket = null;
        }

        blockWebSocket = new WebSocket(wsUrl, { timeout: 10000 });

        blockWebSocket.on('open', async () => {
            await log(`WebSocket connected to ${wsUrl}`);
            wsReconnectAttempts = 0;
            isConnecting = false;

            blockWebSocket.send(JSON.stringify({ action: 'want', data: ['blocks'] }));
            await log('Subscribed to new block notifications');
        });

        blockWebSocket.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                if (message.block) {
                    const newBlockHeight = message.block.height;
                    await log(`NEW BLOCK NOTIFICATION: Block ${newBlockHeight} (Hash: ${message.block.id})`);
                    await handleNewBlock(newBlockHeight);
                }
            } catch (error) { /* ignore non-json messages */ }
        });

        const handleWsFailure = async (source, details) => {
            await log(`WebSocket ${source} (${wsUrl}): ${details}`, 'ERROR');
            isConnecting = false;
            wsReconnectAttempts++;
            await scheduleReconnect();
        };

        blockWebSocket.on('error', (error) => handleWsFailure('error', error.message));
        blockWebSocket.on('close', (code, reason) => handleWsFailure('closed', `code: ${code}, reason: ${reason}`));

        setTimeout(() => {
            if (blockWebSocket && blockWebSocket.readyState === WebSocket.CONNECTING) {
                blockWebSocket.terminate();
                isConnecting = false;
                wsReconnectAttempts++;
                scheduleReconnect();
            }
        }, 10000);

    } catch (error) {
        await log(`Failed to connect WebSocket (${wsUrl}): ${error.message}`, 'ERROR');
        isConnecting = false;
        wsReconnectAttempts++;
        await scheduleReconnect();
    }
}

async function scheduleReconnect() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }

    if (wsReconnectAttempts >= MAX_WS_RECONNECT_ATTEMPTS && currentWSEndpoint === 0) return;

    const delay = Math.min(WS_RECONNECT_DELAY * Math.min(wsReconnectAttempts, 3), 15000);
    await log(`Scheduling WebSocket reconnect in ${delay}ms... (attempt ${wsReconnectAttempts}/${MAX_WS_RECONNECT_ATTEMPTS} for endpoint ${currentWSEndpoint + 1})`);

    wsReconnectTimer = setTimeout(() => { wsReconnectTimer = null; connectBlockWebSocket(); }, delay);
}
// Fallback polling mode
async function startPollingMode() {
    await log('Starting fallback polling mode (checking for new blocks every 30 seconds)...');

    setInterval(async () => {
        try {
            const currentHeight = await getCurrentBlockHeight();
            const lastProcessed = monitoringState.lastProcessedBlock || currentHeight - 1;

            if (currentHeight > lastProcessed) {
                await log(`Polling detected new block(s): ${lastProcessed + 1} to ${currentHeight}`);
                for (let height = lastProcessed + 1; height <= currentHeight; height++) {
                    await processBlockWithSatNumbers(height);
                    monitoringState.lastProcessedBlock = height;
                }
            }
        } catch (error) {
            await log(`Polling error: ${error.message}`, 'ERROR');
        }
    }, 30000);
}

// Get current block height
async function getCurrentBlockHeight() {
    try {
        const response = await fetchWithRetry('https://mempool.space/api/blocks/tip/height');
        const height = parseInt(await response.text());
        if (isNaN(height) || height <= 0) throw new Error(`Invalid block height: ${height}`);
        return height;
    } catch (error) {
        throw new Error(`Failed to get current block height: ${error.message}`);
    }
}

// Handle new block notification
async function handleNewBlock(blockHeight) {
    try {
        const lastProcessed = monitoringState.lastProcessedBlock || blockHeight - 1;

        if (blockHeight > lastProcessed + 1) {
            await log(`Missed blocks detected. Processing blocks ${lastProcessed + 1} to ${blockHeight}`);
            for (let height = lastProcessed + 1; height <= blockHeight; height++) {
                await processBlockWithSatNumbers(height);
                monitoringState.lastProcessedBlock = height;
            }
        } else if (blockHeight === lastProcessed + 1) {
            await processBlockWithSatNumbers(blockHeight);
            monitoringState.lastProcessedBlock = blockHeight;
        }
    } catch (error) {
        await log(`Error handling new block ${blockHeight}: ${error.message}`, 'ERROR');
    }
}

// Process block and extract sat numbers from inscriptions
async function processBlockWithSatNumbers(blockHeight) {
    try {
        await log(`Processing block ${blockHeight} for inscription sat numbers...`);
        const startTime = Date.now();

        // Wait 2.5 seconds for ordinals.com data availability
        await sleep(2500);

        const allInscriptions = await fetchAllBlockInscriptions(blockHeight);
        if (allInscriptions.length === 0) {
            await log(`Block ${blockHeight}: No inscriptions found`);
            monitoringState.totalBlocksProcessed++;
            return { inscriptionsWithMetadata: [], totalInscriptions: 0, processingTimeMs: 0 };
        }

        await log(`Block ${blockHeight}: Found ${allInscriptions.length} inscriptions, getting sat numbers...`);

        const inscriptionsWithMetadata = [];

        // Process inscriptions in batches
        const batchSize = 100;
        for (let i = 0; i < allInscriptions.length; i += batchSize) {
            const batch = allInscriptions.slice(i, i + batchSize);
            const batchPromises = batch.map(async (inscriptionId) => {
                const metadata = await getInscriptionMetadata(inscriptionId);
                if (metadata && metadata.satNumber) {
                    await log(`Inscription ${inscriptionId} -> Sat ${metadata.satNumber}`);
                    return metadata;
                }
                return null;
            });

            const batchResults = await Promise.all(batchPromises);
            inscriptionsWithMetadata.push(...batchResults.filter(r => r !== null));

            // Small delay between batches
            if (i + batchSize < allInscriptions.length) {
                await sleep(5); // Pause between batches
            }
        }

        const processingTime = Date.now() - startTime;
        monitoringState.totalBlocksProcessed++;
        monitoringState.totalInscriptionsChecked += allInscriptions.length;

        // Extract and display sat numbers for this block
        const satNumbers = inscriptionsWithMetadata.map(i => i.satNumber).filter(n => n != null).sort((a, b) => a - b);

        // Show full metadata only in debug mode
        if (isDebugMode && satNumbers.length > 0) {
            console.log(`\nBlock ${blockHeight} - Full Metadata:`);
            console.log(JSON.stringify(inscriptionsWithMetadata, null, 2));
        }

        // Display sat numbers using the formatted utility function
        displaySatNumbers(satNumbers, blockHeight);

        await log(`Block ${blockHeight} completed: Found ${inscriptionsWithMetadata.length} inscriptions with sat numbers (${processingTime}ms)`);

        // Always save results
        const result = {
            blockHeight,
            timestamp: Date.now(),
            processingTimeMs: processingTime,
            totalInscriptions: allInscriptions.length,
            inscriptionsWithMetadata
        };

        // Return the structured result object
        return { inscriptionsWithMetadata, totalInscriptions: allInscriptions.length, processingTimeMs: processingTime };

    } catch (error) {
        await log(`Failed to process block ${blockHeight}: ${error.message}`, 'ERROR');
        throw error;
    }
}

// Fetches inscriptions for a given block height from ordinals.com
function fetchBlockInscriptions(blockHeight, pageIndex = 0) {
    return new Promise((resolve, reject) => {
        const path = pageIndex > 0 ? `/inscriptions/block/${blockHeight}/${pageIndex}` : `/inscriptions/block/${blockHeight}`;
        const options = {
            hostname: 'ordinals.com',
            path,
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';

            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                console.log(`Redirected to: ${res.headers.location}`);
                return reject(new Error('Redirect encountered'));
            }

            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    // Try to parse as JSON first
                    try {
                        const jsonData = JSON.parse(data);
                        resolve(jsonData);
                        return;
                    } catch (jsonError) {
                        // If JSON parsing fails, parse HTML
                        const inscriptionIds = parseInscriptionsFromHTML(data);
                        const hasMore = checkForMorePages(data);
                        resolve({ ids: inscriptionIds, more: hasMore, page_index: pageIndex });
                    }
                } catch (error) {
                    reject(new Error(`Failed to parse response: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => reject(new Error(`Request failed: ${error.message}`)));
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.setTimeout(30000);
        req.end();
    });
}

// Parses inscription IDs from HTML content
function parseInscriptionsFromHTML(html) {
    const ids = new Set();
    const inscriptionRegex = /\/inscription\/([a-f0-9]{64}i\d+)/gi;
    const directIdRegex = /\b([a-f0-9]{64}i\d+)\b/gi;
    let match;
    while ((match = inscriptionRegex.exec(html)) !== null) ids.add(match[1]);
    while ((match = directIdRegex.exec(html)) !== null) ids.add(match[1]);
    return Array.from(ids);
}

// Checks if there are more pages available
function checkForMorePages(html) {
    const nextPageIndicators = [/next/i, /page\s*\d+/i, /more/i, /continue/i];
    return nextPageIndicators.some(rx => rx.test(html));
}

// Fetches all inscriptions for a block by handling pagination
async function fetchAllBlockInscriptions(blockHeight) {
    const allIds = [];
    let pageIndex = 0;
    let hasMore = true;

    console.log(`Fetching inscriptions for block ${blockHeight}...`);

    while (hasMore && pageIndex < 100) {
        try {
            console.log(`Fetching page ${pageIndex}...`);
            const response = await fetchBlockInscriptions(blockHeight, pageIndex);
            if (response.ids && Array.isArray(response.ids)) {
                const newIds = response.ids.filter(id => !allIds.includes(id));
                allIds.push(...newIds);
                console.log(`Found ${response.ids.length} inscriptions on page ${pageIndex} (${newIds.length} new)`);
                if (response.ids.length === 0) hasMore = false;
            } else {
                console.log(`No inscriptions found on page ${pageIndex}`);
                hasMore = false;
            }

            if (response.more === false || (response.ids && response.ids.length === 0)) hasMore = false;
            pageIndex++;
            if (hasMore) await sleep(2);
        } catch (error) {
            console.error(`Error fetching page ${pageIndex}:`, error.message);
            break;
        }
    }

    return allIds;
}

// Fetches inscription metadata using multiple methods
async function getInscriptionMetadata(inscriptionId) {
    try {
        let metadata = null;

        // Method 1: Try the /r/inscription/ endpoint first
        try {
            const metaResponse = await fetchWithRetry(`https://ordinals.com/r/inscription/${inscriptionId}`);
            metadata = await metaResponse.json();
        } catch (error) {
            console.log(`Method 1 failed for ${inscriptionId}: ${error.message}`);
        }

        // Method 2: Try the main /inscription/ endpoint
        if (!metadata || !metadata.satpoint) {
            try {
                const altResponse = await fetchWithRetry(`https://ordinals.com/inscription/${inscriptionId}`);
                const altData = await altResponse.json();
                if (altData.sat || altData.satpoint) metadata = { ...metadata, ...altData };
            } catch (error) {
                console.log(`Method 2 failed for ${inscriptionId}: ${error.message}`);
            }
        }

        if (!metadata) return null;

        // Extract sat number from various possible fields
        let satNumber = null;
        if (metadata.sat) satNumber = parseInt(metadata.sat);
        else if (metadata.satpoint) {
            const satMatch = metadata.satpoint.match(/^(\d+):/);
            if (satMatch) satNumber = parseInt(satMatch[1]);
        }

        return {
            inscriptionId,
            satNumber,
            satpoint: metadata.satpoint,
            blockHeight: metadata.genesis_height || metadata.height,
            timestamp: metadata.genesis_timestamp || metadata.timestamp,
            contentType: metadata.content_type,
            contentLength: metadata.content_length,
            address: metadata.address,
            outputValue: metadata.output_value,
            output: metadata.output
        };
    } catch (error) {
        return null;
    }
}

// Enhanced fetch with retry logic
async function fetchWithRetry(url, maxRetries = 3) {
    const delays = [1000, 2000, 5000];
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(url);
            if (response.status === 429) {
                const retryAfter = parseInt(response.headers.get('Retry-After')) || 60;
                console.log(`Rate limit hit for ${url}. Waiting ${retryAfter}s...`);
                await sleep(retryAfter * 1000);
                continue;
            }
            if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
            return response;
        } catch (error) {
            if (attempt === maxRetries - 1) throw error;
            const delay = delays[attempt] || delays[delays.length - 1];
            console.log(`Retrying ${url} after ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
            await sleep(delay);
        }
    }
}

// Status reporting and shutdown handling to avoid duplication
let statusTimer = null;
function startStatusReporting() {
    if (statusTimer) return;
    statusTimer = setInterval(async () => {
        const uptime = Date.now() - monitoringState.startTime;
        const uptimeMinutes = Math.floor(uptime / 1000 / 60);
        await log(`STATUS: Uptime ${uptimeMinutes}m, Blocks: ${monitoringState.totalBlocksProcessed}, Inscriptions: ${monitoringState.totalInscriptionsChecked}, Last Block: ${monitoringState.lastProcessedBlock}`);
    }, 5 * 60 * 1000);
}

let shutdownAttached = false;
function attachShutdownHandlers() {
    if (shutdownAttached) return;
    shutdownAttached = true;

    const handler = async () => {
        await log('Received termination signal, shutting down gracefully...');
        await disconnectWebSocket();
        process.exit(0);
    };

    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);
}

// Start continuous monitoring from a specific height
async function startFromHeight(startHeight) {
    await log(`Starting continuous monitoring from block ${startHeight}...`);
    monitoringState.lastProcessedBlock = startHeight - 1;

    // Get current height and process any blocks between start and current
    const currentHeight = await getCurrentBlockHeight();
    if (currentHeight >= startHeight) {
        await log(`Processing blocks ${startHeight} to ${currentHeight}`);
        for (let height = startHeight; height <= currentHeight; height++) {
            await processBlockWithSatNumbers(height);
            monitoringState.lastProcessedBlock = height;
        }
    }

    // Connect to WebSocket for live monitoring
    await connectBlockWebSocket();
    startStatusReporting();
    attachShutdownHandlers();
    await log('Continuous monitoring active. Waiting for new block notifications...');
}

// Start live monitoring
async function startLiveMonitoring() {
    await log('Starting live Bitcoin block monitoring for inscription sat numbers...');
    // Connect to WebSocket 
    await connectBlockWebSocket();
    startStatusReporting();
    attachShutdownHandlers();
    await log('Live monitoring active. Waiting for new block notifications...');
}

// Disconnect WebSocket
async function disconnectWebSocket() {
    if (blockWebSocket) {
        blockWebSocket.removeAllListeners();
        blockWebSocket.close();
        blockWebSocket = null;
    }
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    isConnecting = false;
    wsReconnectAttempts = 0;
}

// Main function to handle command line arguments and execute the script
async function main() {
    const args = process.argv.slice(2);
    let singleBlockHeight = null;
    let startHeight = null;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--start-height' || args[i] === '--start-block') { startHeight = parseInt(args[i + 1]); i++; }
        else if (args[i] === '--debug') { isDebugMode = true; }
        else {
            const blockNum = parseInt(args[i]);
            if (!isNaN(blockNum) && blockNum > 0 && !singleBlockHeight) singleBlockHeight = blockNum;
        }
    }

    // Handle different execution modes
    if (singleBlockHeight) {
        await log(`Single block mode: Processing block ${singleBlockHeight}...`);
        try {
            const { inscriptionsWithMetadata, totalInscriptions } = await processBlockWithSatNumbers(singleBlockHeight);

            const result = { blockHeight: singleBlockHeight, totalInscriptions, inscriptionsWithMetadata };
            const satNumbers = inscriptionsWithMetadata.map(i => i.satNumber).filter(n => n !== null && n !== undefined).sort((a, b) => a - b);

        } catch (error) {
            console.error('Error:', error.message);
            process.exit(1);
        }

    } else if (startHeight) {
        // Continuous monitoring from specific height
        await startFromHeight(startHeight);
    } else {
        // Live monitoring mode (no arguments)
        await startLiveMonitoring();
    }
}
// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}


export {
    fetchBlockInscriptions,
    fetchAllBlockInscriptions,
    startFromHeight,
    startLiveMonitoring,
    processBlockWithSatNumbers,
    disconnectWebSocket
};