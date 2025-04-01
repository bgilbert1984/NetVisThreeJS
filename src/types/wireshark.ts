export interface NetworkHost {
  id: string;
  ip: string;
  packets: number;
  bytesTransferred: number;
}

export interface NetworkStream {
  source: string;
  target: string;
  protocol: string;
  packets: number;
  bytes: number;
  timestamp: number;
}

export interface WiresharkData {
  hosts: NetworkHost[];
  streams: NetworkStream[];
}