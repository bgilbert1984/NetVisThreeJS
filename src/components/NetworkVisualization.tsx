import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';

interface NetworkHost {
  id: string;
  ip: string;
  packets: number;
  bytesTransferred: number;
}

interface NetworkStream {
  source: string;
  target: string;
  protocol: string;
  packets: number;
  bytes: number;
  timestamp: number;
}

interface WiresharkData {
  hosts: NetworkHost[];
  streams: NetworkStream[];
}

interface NetworkVisualizationProps {
  data: WiresharkData;
  width?: string;
  height?: string;
}

// Color schemes for different protocols
const protocolColors: Record<string, string> = {
  TCP: '#ff0000',
  UDP: '#00ff00',
  ICMP: '#0000ff',
  HTTP: '#ff00ff',
  HTTPS: '#00ffff',
  DNS: '#ffff00',
  default: '#ffffff'
};

const NodeMesh: React.FC<{ 
  position: [number, number, number]; 
  color?: string;
  size?: number;
  label?: string;
  data?: NetworkHost;
}> = ({ position, color = '#ff0000', size = 0.5, label, data }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <mesh 
      position={position}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
    >
      <sphereGeometry args={[size, 32, 32]} />
      <meshStandardMaterial color={hovered ? '#ffffff' : color} />
      {(hovered && data) && (
        <Html distanceFactor={10}>
          <div style={{
            backgroundColor: 'rgba(0,0,0,0.8)',
            padding: '8px',
            borderRadius: '4px',
            color: 'white',
            fontSize: '12px',
            whiteSpace: 'nowrap'
          }}>
            <div>IP: {data.ip}</div>
            <div>Packets: {data.packets}</div>
            <div>Bytes: {data.bytesTransferred}</div>
          </div>
        </Html>
      )}
    </mesh>
  );
}

const EdgeLine: React.FC<{ 
  start: [number, number, number]; 
  end: [number, number, number]; 
  color?: string;
  width?: number;
  data?: NetworkStream;
}> = ({ start, end, color = '#ffffff', width = 1, data }) => {
  const [hovered, setHovered] = useState(false);
  const points = [new THREE.Vector3(...start), new THREE.Vector3(...end)];
  const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);

  const material = useMemo(() => 
    new THREE.LineBasicMaterial({ 
      color: color,
      linewidth: width,
    }), [color, width]);

  return (
    <>
      <lineSegments 
        geometry={lineGeometry}
        material={material}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      />
      {(hovered && data) && (
        <Html position={[
          (start[0] + end[0]) / 2,
          (start[1] + end[1]) / 2,
          (start[2] + end[2]) / 2
        ]}>
          <div style={{
            backgroundColor: 'rgba(0,0,0,0.8)',
            padding: '8px',
            borderRadius: '4px',
            color: 'white',
            fontSize: '12px',
            whiteSpace: 'nowrap'
          }}>
            <div>Protocol: {data.protocol}</div>
            <div>Packets: {data.packets}</div>
            <div>Bytes: {data.bytes}</div>
          </div>
        </Html>
      )}
    </>
  );
}

const calculateNodePositions = (hosts: NetworkHost[]): Map<string, [number, number, number]> => {
  const positions = new Map<string, [number, number, number]>();
  const radius = 10;
  const angleStep = (2 * Math.PI) / hosts.length;

  hosts.forEach((host, index) => {
    const angle = angleStep * index;
    const x = radius * Math.cos(angle);
    const z = radius * Math.sin(angle);
    positions.set(host.id, [x, 0, z]);
  });

  return positions;
};

const NetworkGraph: React.FC<{ data: WiresharkData }> = ({ data }) => {
  const nodePositions = useMemo(() => calculateNodePositions(data.hosts), [data.hosts]);

  return (
    <>
      {data.hosts.map((host) => {
        const position = nodePositions.get(host.id);
        if (!position) return null;
        
        return (
          <NodeMesh
            key={host.id}
            position={position}
            color={protocolColors.default}
            size={0.5 + (Math.log(host.packets) / Math.log(10)) * 0.2}
            data={host}
          />
        );
      })}
      {data.streams.map((stream, index) => {
        const sourcePos = nodePositions.get(stream.source);
        const targetPos = nodePositions.get(stream.target);
        if (!sourcePos || !targetPos) return null;

        const protocol = stream.protocol.toUpperCase();
        const color = protocolColors[protocol] || protocolColors.default;
        const width = Math.log(stream.packets) / Math.log(10);
        
        return (
          <EdgeLine
            key={`${stream.source}-${stream.target}-${index}`}
            start={sourcePos}
            end={targetPos}
            color={color}
            width={width}
            data={stream}
          />
        );
      })}
    </>
  );
}

export const NetworkVisualization: React.FC<NetworkVisualizationProps> = ({ data, width = '100%', height = '600px' }) => {
  return (
    <div style={{ width, height }}>
      <Canvas
        camera={{ position: [0, 20, 20], fov: 75 }}
      >
        <color attach="background" args={['#000000']} />
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <NetworkGraph data={data} />
        <OrbitControls />
      </Canvas>
    </div>
  );
}