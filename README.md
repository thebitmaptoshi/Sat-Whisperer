# SatWhisperer 🔍

A real-time Bitcoin ordinals inscription monitoring tool that tracks and displays sat numbers from newly mined blocks.

## Overview

SatWhisperer monitors Bitcoin blocks in real-time and extracts ordinal inscription data, specifically focusing on the sat numbers associated with each inscription. It provides both live monitoring and historical block analysis capabilities.

## Features

- **Real-time Block Monitoring**: Connects to mempool.space WebSocket for instant new block notifications
- **Inscription Tracking**: Fetches all inscriptions from each block using ordinals.com API
- **Sat Number Extraction**: Retrieves and displays the specific sat numbers for each inscription
- **Multiple Operation Modes**: Single block analysis, range monitoring, or continuous live tracking
- **Fallback Systems**: Automatic failover to polling mode if WebSocket connections fail
- **Rate Limiting**: Built-in retry logic and rate limit handling for API requests
- **Formatted Output**: Color-coded, column-formatted display of sat numbers
- **Debug Mode**: Extended logging and metadata display for troubleshooting
- **Modular Design**: Can be imported as a module for integration into other projects
- **Forkable** Feel free to customize and extend the functionality as needed, can get any inscrption data from ordinals.com API

## Installation

### Prerequisites
- Node.js (version 14 or higher)
- npm or yarn package manager

### Setup
1. Clone or download the script
2. Install dependencies:
```bash
npm install ws
```

3. Make the script executable (Unix/Linux/macOS):
```bash
chmod +x SatWhisperer.mjs
```

## Usage

### Live Monitoring Mode
Monitor new blocks as they are mined:
```bash
node SatWhisperer.mjs
```
or
```bash
./SatWhisperer.mjs
```

### Single Block Analysis
Analyze a specific block:
```bash
node SatWhisperer.mjs <block_height>
```

Example:
```bash
node SatWhisperer.mjs 792435
```

### Historical Range Monitoring
Start monitoring from a specific block height:
```bash
node SatWhisperer.mjs --start-height <block_height>
```

Example:
```bash
node SatWhisperer.mjs --start-height 792435
```

### Debug Mode
Enable detailed logging and metadata output:
```bash
node SatWhisperer.mjs --debug
```

Can be combined with other modes:
```bash
node SatWhisperer.mjs --debug --start-height 820000
```

## Output Format

### Sat Number Display
When inscriptions are found, sat numbers are displayed in a formatted grid:

```
Block 820123 - Sat Numbers Found (8 total):
1234567890123456    2345678901234567    3456789012345678    
4567890123456789    5678901234567890    6789012345678901    
7890123456789012    8901234567890123    
```

### Status Logging
Regular status updates show monitoring progress:
```
[2024-01-15T10:30:00.000Z] [INFO] STATUS: Uptime 15m, Blocks: 5, Inscriptions: 42, Last Block: 820125
```

### Block Processing
Detailed processing information for each block:
```
[2024-01-15T10:30:00.000Z] [INFO] NEW BLOCK NOTIFICATION: Block 820126 (Hash: 000000000000000...)
[2024-01-15T10:30:00.000Z] [INFO] Processing block 820126 for inscription sat numbers...
[2024-01-15T10:30:02.500Z] [INFO] Block 820126: Found 15 inscriptions, getting sat numbers...
[2024-01-15T10:30:05.123Z] [INFO] Block 820126 completed: Found 12 inscriptions with sat numbers (2623ms)
```

## Technical Details

### Rate Limiting
- Automatic retry with exponential backoff
- Respects `Retry-After` headers from APIs
- Batch processing to reduce API load

### Error Handling
- Multiple WebSocket endpoint failover
- Graceful degradation to polling mode
- Comprehensive error logging and recovery

### Performance
- Concurrent processing of inscription metadata
- Configurable batch sizes (default: 100 inscriptions)
- Minimal memory footprint with streaming data processing

## API Endpoints Used

| Service | Endpoint | Purpose |
|---------|----------|---------|
| mempool.space | `wss://mempool.space/api/v1/ws` | Real-time block notifications |
| mempool.space | `https://mempool.space/api/blocks/tip/height` | Current block height |
| ordinals.com | `https://ordinals.com/inscriptions/block/{height}` | Block inscriptions |
| ordinals.com | `https://ordinals.com/r/inscription/{id}` | Inscription metadata |
| ordinals.com | `https://ordinals.com/inscription/{id}` | Alternative metadata endpoint |

## Configuration

### WebSocket Settings
- Connection timeout: 10 seconds
- Reconnection attempts: 5 per endpoint
- Reconnection delay: 5-15 seconds with exponential backoff

### API Request Settings
- Request timeout: 30 seconds
- Maximum retries: 3 attempts
- Retry delays: 1s, 2s, 5s

## Troubleshooting

### Common Issues

**WebSocket Connection Failures**
- The script automatically tries multiple endpoints and falls back to polling
- Check internet connectivity and firewall settings

**Rate Limiting**
- The script handles rate limits automatically with exponential backoff
- Consider adding delays between requests if experiencing persistent issues

**Missing Inscription Data**
- Some inscriptions may not have sat number data immediately available
- The script waits 2.5 seconds after block notification for data propagation

**High Memory Usage**
- Large blocks with many inscriptions may use significant memory
- Monitor system resources during operation

### Debug Mode
Enable debug mode for detailed troubleshooting:
```bash
node SatWhisperer.mjs --debug
```

This provides:
- Full inscription metadata output
- Detailed API request/response logging
- WebSocket connection status updates
- Processing timing information

## Command Line Arguments

| Argument | Description | Example |
|----------|-------------|---------|
| `<block_height>` | Process a single specific block | `node SatWhisperer.mjs 820000` |
| `--start-height <height>` | Start monitoring from specific height | `--start-height 820000` |
| `--start-block <height>` | Alias for --start-height | `--start-block 820000` |
| `--debug` | Enable debug mode with detailed output | `--debug` |

## Module Exports

The script can also be imported as a module:

```javascript
import { 
    fetchBlockInscriptions,
    fetchAllBlockInscriptions,
    startFromHeight,
    startLiveMonitoring,
    processBlockWithSatNumbers,
    disconnectWebSocket
} from './SatWhisperer.mjs';
```

### Exported Functions

- `fetchBlockInscriptions(blockHeight, pageIndex)` - Fetch inscriptions for a specific block page
- `fetchAllBlockInscriptions(blockHeight)` - Fetch all inscriptions for a block (handles pagination)
- `startFromHeight(startHeight)` - Begin monitoring from a specific block height
- `startLiveMonitoring()` - Start real-time monitoring
- `processBlockWithSatNumbers(blockHeight)` - Process a single block and return results
- `disconnectWebSocket()` - Clean shutdown of WebSocket connections

## License

This script is provided as-is for educational and research purposes. Please respect the APIs' terms of service and rate limits.

## Contributing

Feel free to submit issues, feature requests, or improvements. The script is designed to be modular and extensible.

## Disclaimer

This tool is for informational purposes only. Bitcoin ordinals and inscription data can change rapidly, and this script provides a best-effort real-time view. Always verify critical information through multiple sources.

## Version History

- **v1.0**: Initial release with basic monitoring capabilities, enhanced error handling, fallback systems, and efficient formatting
