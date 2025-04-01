import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { spawn } from 'child_process';
import cors from 'cors';
import { WiresharkData, NetworkHost, NetworkStream } from '../types/wireshark';

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"],
    methods: ["GET", "POST"],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ['websocket', 'polling']
});

// Add health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

interface PacketData {
  _source: {
    layers: {
      frame: { "frame.time_epoch": string };
      ip: { 
        "ip.src": string;
        "ip.dst": string;
        "ip.proto": string;
        "ip.len": string;
      };
      tcp?: { "tcp.srcport": string; "tcp.dstport": string };
      udp?: { "udp.srcport": string; "udp.dstport": string };
    };
  };
}

class NetworkTrafficAggregator {
  private hosts: Map<string, NetworkHost> = new Map();
  private streams: Map<string, NetworkStream> = new Map();
  private hostIdCounter = 0;

  addPacket(packet: PacketData) {
    const { ip } = packet._source.layers;
    const srcIp = ip["ip.src"];
    const dstIp = ip["ip.dst"];
    const protocol = this.getProtocol(packet);
    const bytes = parseInt(ip["ip.len"]);
    const timestamp = parseFloat(packet._source.layers.frame["frame.time_epoch"]) * 1000;

    // Update hosts
    const srcHost = this.getOrCreateHost(srcIp);
    const dstHost = this.getOrCreateHost(dstIp);

    srcHost.packets++;
    dstHost.packets++;
    srcHost.bytesTransferred += bytes;
    dstHost.bytesTransferred += bytes;

    // Update stream
    const streamKey = `${srcHost.id}-${dstHost.id}-${protocol}`;
    let stream = this.streams.get(streamKey);
    if (!stream) {
      stream = {
        source: srcHost.id,
        target: dstHost.id,
        protocol,
        packets: 0,
        bytes: 0,
        timestamp
      };
      this.streams.set(streamKey, stream);
    }
    stream.packets++;
    stream.bytes += bytes;
    stream.timestamp = timestamp;

    return this.getVisualizationData();
  }

  private getOrCreateHost(ip: string): NetworkHost {
    let host = Array.from(this.hosts.values()).find(h => h.ip === ip);
    if (!host) {
      host = {
        id: (++this.hostIdCounter).toString(),
        ip,
        packets: 0,
        bytesTransferred: 0
      };
      this.hosts.set(host.id, host);
    }
    return host;
  }

  private getProtocol(packet: PacketData): string {
    const { ip } = packet._source.layers;
    if (packet._source.layers.tcp) return 'TCP';
    if (packet._source.layers.udp) return 'UDP';
    return 'OTHER';
  }

  getVisualizationData(): WiresharkData {
    return {
      hosts: Array.from(this.hosts.values()),
      streams: Array.from(this.streams.values())
    };
  }
}

const startCapture = (networkInterface: string = 'any') => {
  const aggregator = new NetworkTrafficAggregator();
  
  // Use sudo to run tshark with elevated privileges
  const tshark = spawn('sudo', [
    'tshark',
    '-i', networkInterface,
    '-T', 'json',
    '-l',
    '-f', 'ip'  // Filter for IP packets only
  ]);

  tshark.stderr.on('data', (data) => {
    const errorMsg = data.toString();
    console.error('tshark error:', errorMsg);
    if (errorMsg.includes('Permission denied')) {
      io.emit('error', { 
        message: 'Permission denied. Please run the server with sudo privileges.'
      });
    }
  });

  let buffer = '';
  tshark.stdout.on('data', (data) => {
    buffer += data.toString();
    
    try {
      const packet: PacketData = JSON.parse(buffer);
      const visualizationData = aggregator.addPacket(packet);
      io.emit('networkUpdate', visualizationData);
      buffer = '';
    } catch (e) {
      // Incomplete JSON, continue buffering
      if (buffer.length > 1000000) { // Reset if buffer gets too large
        buffer = '';
      }
    }
  });

  tshark.on('error', (error) => {
    console.error('Failed to start tshark:', error);
    io.emit('error', { 
      message: 'Failed to start packet capture. Check permissions and tshark installation.'
    });
  });

  return tshark;
};

// Mock data generator for test traffic
class TestTrafficGenerator {
  private running = false;
  private interval: NodeJS.Timeout | null = null;
  private aggregator: NetworkTrafficAggregator;
  private ips = [
    '192.168.1.1', '192.168.1.2', '192.168.1.100', 
    '10.0.0.1', '10.0.0.2', '10.0.0.3',
    '172.16.0.1', '8.8.8.8', '1.1.1.1'
  ];
  private protocols = ['TCP', 'UDP', 'HTTP', 'HTTPS', 'DNS'];
  
  constructor() {
    this.aggregator = new NetworkTrafficAggregator();
  }

  start(io: Server) {
    if (this.running) return;
    this.running = true;
    
    // Generate traffic every 500ms
    this.interval = setInterval(() => {
      const packet = this.generateRandomPacket();
      const visualizationData = this.aggregator.addPacket(packet);
      io.emit('networkUpdate', visualizationData);
    }, 500);
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private generateRandomPacket(): PacketData {
    const srcIpIndex = Math.floor(Math.random() * this.ips.length);
    let dstIpIndex = Math.floor(Math.random() * this.ips.length);
    
    // Ensure source and destination are different
    while (dstIpIndex === srcIpIndex) {
      dstIpIndex = Math.floor(Math.random() * this.ips.length);
    }
    
    const protocolIndex = Math.floor(Math.random() * this.protocols.length);
    const protocol = this.protocols[protocolIndex];
    const bytes = Math.floor(Math.random() * 1500) + 50; // Random packet size between 50 and 1550 bytes
    
    let tcpData;
    let udpData;
    
    if (protocol === 'TCP' || protocol === 'HTTP' || protocol === 'HTTPS') {
      const srcPort = (Math.floor(Math.random() * 60000) + 1024).toString();
      let dstPort = (Math.floor(Math.random() * 60000) + 1024).toString();
      
      // Set appropriate destination ports for HTTP/HTTPS
      if (protocol === 'HTTP') {
        dstPort = '80';
      } else if (protocol === 'HTTPS') {
        dstPort = '443';
      }
      
      tcpData = { 
        "tcp.srcport": srcPort,
        "tcp.dstport": dstPort
      };
    } else if (protocol === 'UDP' || protocol === 'DNS') {
      const srcPort = (Math.floor(Math.random() * 60000) + 1024).toString();
      let dstPort = (Math.floor(Math.random() * 60000) + 1024).toString();
      
      // Set appropriate destination port for DNS
      if (protocol === 'DNS') {
        dstPort = '53';
      }
      
      udpData = {
        "udp.srcport": srcPort,
        "udp.dstport": dstPort
      };
    }
    
    return {
      _source: {
        layers: {
          frame: { 
            "frame.time_epoch": (Date.now() / 1000).toString()
          },
          ip: {
            "ip.src": this.ips[srcIpIndex],
            "ip.dst": this.ips[dstIpIndex],
            "ip.proto": protocol === 'TCP' || protocol === 'HTTP' || protocol === 'HTTPS' ? '6' : 
                        protocol === 'UDP' || protocol === 'DNS' ? '17' : '1',
            "ip.len": bytes.toString()
          },
          tcp: tcpData,
          udp: udpData
        }
      }
    };
  }
}

// Create test traffic generator
const testTrafficGenerator = new TestTrafficGenerator();

io.on('connection', (socket) => {
  console.log('Client connected');
  let capture: ReturnType<typeof startCapture> | null = null;
  
  socket.on('startCapture', (networkInterface: string) => {
    console.log('Starting capture on interface:', networkInterface);
    try {
      if (networkInterface === 'test') {
        console.log('Starting test traffic generator');
        testTrafficGenerator.start(io);
      } else {
        capture = startCapture(networkInterface);
      }
    } catch (err) {
      console.error('Failed to start capture:', err);
      socket.emit('error', { message: 'Failed to start capture' });
    }
  });

  socket.on('stopTestTraffic', () => {
    console.log('Stopping test traffic generator');
    testTrafficGenerator.stop();
  });

  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
    if (capture) {
      capture.kill();
      console.log('Capture stopped');
    }
    
    // Also stop test traffic generator if running
    testTrafficGenerator.stop();
  });
});

const cleanup = () => {
  console.log('Cleaning up...');
  io.close();
  httpServer.close();
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

const PORT = process.env.PORT || 3002;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});