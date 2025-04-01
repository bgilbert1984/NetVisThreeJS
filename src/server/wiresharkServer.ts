import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { spawn } from 'child_process';
import cors from 'cors';
import { Transform } from 'stream';
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
  allowEIO3: true,
  transports: ['websocket', 'polling']
});

// Add basic health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
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
  
  const tshark = spawn('tshark', [
    '-i', networkInterface,
    '-T', 'json',
    '-l'
  ]);

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
    }
  });

  return tshark;
};

io.on('connection', (socket) => {
  console.log('Client connected');
  
  socket.on('error', (error) => {
    console.error('Socket error:', error);
  });
  
  socket.on('startCapture', (networkInterface: string) => {
    console.log(`Starting capture on interface: ${networkInterface}`);
    try {
      const capture = startCapture(networkInterface);
      
      capture.on('error', (error) => {
        console.error('Capture error:', error);
        socket.emit('error', { message: 'Capture failed' });
      });
      
      socket.on('disconnect', () => {
        capture.kill();
        console.log('Client disconnected, stopping capture');
      });
    } catch (error) {
      console.error('Failed to start capture:', error);
      socket.emit('error', { message: 'Failed to start capture' });
    }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}).on('error', (error) => {
  console.error('Server failed to start:', error);
});