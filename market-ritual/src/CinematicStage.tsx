import React from 'react';
import { PhoneView } from './PhoneView';
import type { ArtistAsset, CinematicScene } from './types';
import { getAssetBlob } from './asset-library';
import { createFallbackMesh, parseModel, type ModelMesh } from './model-loader';
import { seededRandom } from './generative';

const { useEffect, useMemo, useRef, useState } = React;

type RenderMesh = ModelMesh & { position: WebGLBuffer; normal: WebGLBuffer; color: [number, number, number] };

const vertexShader = `
precision mediump float;
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform float uTime;
uniform float uSignal;
uniform float uIndex;
uniform float uAspect;
varying vec3 vNormal;
varying float vDepth;
void main() {
  float ay = uTime * (0.18 + uIndex * 0.05) + uSignal * 1.8 + uIndex * 1.7;
  float ax = sin(uTime * 0.22 + uIndex) * 0.26 + uSignal * 0.2;
  mat3 ry = mat3(cos(ay),0.0,sin(ay), 0.0,1.0,0.0, -sin(ay),0.0,cos(ay));
  mat3 rx = mat3(1.0,0.0,0.0, 0.0,cos(ax),-sin(ax), 0.0,sin(ax),cos(ax));
  float pulse = 0.82 + sin(uTime * 0.7 + uIndex * 2.0) * 0.07 + uSignal * 0.16;
  vec3 p = rx * ry * aPosition * pulse;
  p.x += (uIndex - 1.0) * 1.35;
  p.y += sin(uTime * 0.45 + uIndex * 2.2) * (0.16 + uSignal * 0.15);
  p.z += uIndex * -0.38;
  float cameraZ = 5.1;
  float w = max(0.2, p.z + cameraZ);
  gl_Position = vec4(p.x * 2.1 / uAspect, p.y * 2.1, w - 0.12, w);
  vNormal = normalize(rx * ry * aNormal);
  vDepth = w;
}`;

const fragmentShader = `
precision mediump float;
uniform vec3 uColor;
uniform float uSignal;
varying vec3 vNormal;
varying float vDepth;
void main() {
  vec3 light = normalize(vec3(-0.4, 0.8, 0.6));
  float diffuse = max(dot(vNormal, light), 0.0);
  float rim = pow(1.0 - abs(vNormal.z), 2.5);
  vec3 acid = vec3(0.71, 1.0, 0.28);
  vec3 color = uColor * (0.25 + diffuse * 0.9) + acid * rim * (0.5 + uSignal);
  float fog = smoothstep(3.8, 6.3, vDepth);
  color = mix(color, vec3(0.055, 0.06, 0.055), fog * 0.72);
  gl_FragColor = vec4(color, 0.92);
}`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL shader allocation failed.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'WebGL shader compilation failed.');
  return shader;
}

function WebGLModels({ assets, seed, signal, quality }: { assets: ArtistAsset[]; seed: string; signal: number; quality: 'high' | 'adaptive' }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signalRef = useRef(signal);
  const [error, setError] = useState('');
  signalRef.current = signal;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, powerPreference: 'high-performance' });
    if (!gl) { setError('WEBGL UNAVAILABLE / 2D FALLBACK ACTIVE'); return; }
    let disposed = false;
    let frame = 0;
    let meshes: RenderMesh[] = [];
    const program = gl.createProgram();
    if (!program) return;
    try {
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexShader));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentShader));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'WebGL program linking failed.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '3D renderer failed.');
      return;
    }
    const locations = {
      position: gl.getAttribLocation(program, 'aPosition'), normal: gl.getAttribLocation(program, 'aNormal'),
      time: gl.getUniformLocation(program, 'uTime'), signal: gl.getUniformLocation(program, 'uSignal'),
      index: gl.getUniformLocation(program, 'uIndex'), aspect: gl.getUniformLocation(program, 'uAspect'), color: gl.getUniformLocation(program, 'uColor'),
    };
    const random = seededRandom(`${seed}:webgl`);
    const palette: [number, number, number][] = [[0.23,0.34,1],[0.95,0.24,0.12],[0.04,0.64,0.42],[0.72,0.22,0.96]];
    const createRenderMesh = (mesh: ModelMesh, index: number): RenderMesh => {
      const position = gl.createBuffer();
      const normal = gl.createBuffer();
      if (!position || !normal) throw new Error('3D buffer allocation failed.');
      gl.bindBuffer(gl.ARRAY_BUFFER, position); gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, normal); gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW);
      return { ...mesh, position, normal, color: palette[(index + Math.floor(random() * palette.length)) % palette.length] };
    };
    Promise.all(assets.slice(0, 3).map(async (asset, index) => {
      const blob = await getAssetBlob(asset.id);
      if (!blob) throw new Error(`${asset.name} is missing from local storage.`);
      return createRenderMesh(await parseModel(blob, asset.format), index);
    })).then((loaded) => {
      if (disposed) return;
      meshes = loaded.length ? loaded : [createRenderMesh(createFallbackMesh(), 0)];
    }).catch((reason) => {
      setError(reason instanceof Error ? reason.message : 'Model could not be rendered.');
      meshes = [createRenderMesh(createFallbackMesh(), 0)];
    });
    if (!assets.length) meshes = [createRenderMesh(createFallbackMesh(), 0)];

    let lastSample = performance.now();
    let sampleFrames = 0;
    let dpr = Math.min(devicePixelRatio, quality === 'high' ? 1.75 : 1.35);
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(bounds.width * dpr));
      const height = Math.max(1, Math.floor(bounds.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0, 0, width, height);
    };
    const render = (time: number) => {
      if (disposed) return;
      resize();
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      gl.uniform1f(locations.time, time / 1000); gl.uniform1f(locations.signal, signalRef.current); gl.uniform1f(locations.aspect, canvas.width / canvas.height);
      meshes.forEach((mesh, index) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.position); gl.enableVertexAttribArray(locations.position); gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normal); gl.enableVertexAttribArray(locations.normal); gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
        gl.uniform1f(locations.index, meshes.length === 1 ? 1 : index); gl.uniform3fv(locations.color, mesh.color);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.vertexCount);
      });
      sampleFrames += 1;
      if (quality === 'adaptive' && time - lastSample > 1800) {
        const fps = sampleFrames * 1000 / (time - lastSample);
        if (fps < 40 && dpr > 0.75) dpr = Math.max(0.75, dpr - 0.2);
        lastSample = time; sampleFrames = 0;
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    const lost = (event: Event) => { event.preventDefault(); setError('3D CONTEXT LOST / RELOAD TO RESTORE'); };
    canvas.addEventListener('webglcontextlost', lost);
    return () => {
      disposed = true; cancelAnimationFrame(frame); canvas.removeEventListener('webglcontextlost', lost);
      meshes.forEach((mesh) => { gl.deleteBuffer(mesh.position); gl.deleteBuffer(mesh.normal); });
      gl.deleteProgram(program);
    };
  }, [assets.map((asset) => asset.id).join(':'), seed, quality]);

  return <div className="webgl-model-plane"><canvas ref={canvasRef} aria-label="Reactive 3D model composition" />{error && <span className="webgl-error">{error}</span>}</div>;
}

function VideoLayer({ asset, index, signal, sound, volume }: { asset: ArtistAsset; index: number; signal: number; sound: boolean; volume: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.playbackRate = 0.72 + signal * 0.85 + index * 0.08;
    ref.current.volume = index === 0 && sound ? volume : 0;
    ref.current.muted = !(index === 0 && sound);
    ref.current.play().catch(() => undefined);
  }, [signal, sound, volume, index]);
  return <video ref={ref} className={`cinematic-video video-${index}`} src={asset.objectUrl} autoPlay loop muted={!sound || index > 0} playsInline />;
}

export function CinematicStage({
  assets, scene, signal, immersive, sound, onExit, onToggleSound, onPreset, children,
}: {
  assets: ArtistAsset[]; scene: CinematicScene; signal: number; immersive: boolean; sound: boolean;
  onExit?: () => void; onToggleSound: () => void; onPreset: (preset: CinematicScene['preset']) => void; children?: React.ReactNode;
}) {
  const videos = assets.filter((asset) => asset.kind === 'video').slice(0, 2);
  const images = assets.filter((asset) => asset.kind === 'image').slice(0, 6);
  const models = assets.filter((asset) => asset.kind === 'model').slice(0, 3);
  const placements = useMemo(() => {
    const random = seededRandom(`${scene.seed}:uploaded-images`);
    return images.map(() => ({ left: 5 + random() * 78, top: 6 + random() * 72, size: 18 + random() * 28, rotate: -18 + random() * 36, opacity: .24 + random() * .5 }));
  }, [images.map((asset) => asset.id).join(':'), scene.seed]);
  return (
    <section className={`cinematic-compositor preset-${scene.preset} ${immersive ? 'immersive' : 'embedded'}`}>
      <div className="cinematic-video-plane">
        {videos.map((asset, index) => <VideoLayer key={asset.id} asset={asset} index={index} signal={signal} sound={sound} volume={scene.masterVolume} />)}
        {!videos.length && <div className="cinematic-default-film"><i /><i /><i /></div>}
      </div>
      <WebGLModels assets={models} seed={scene.seed} signal={signal} quality="adaptive" />
      <div className="cinematic-image-plane">
        {images.map((asset, index) => <img key={asset.id} src={asset.objectUrl} alt="" style={{ left: `${placements[index].left}%`, top: `${placements[index].top}%`, width: `${placements[index].size}%`, opacity: placements[index].opacity + signal * .16, transform: `translate(-50%,-50%) rotate(${placements[index].rotate + signal * 8}deg) scale(${1 + signal * .12})` }} />)}
      </div>
      <div className="cinematic-chart-plane">{children}</div>
      <div className="cinematic-fx" aria-hidden="true" />
      {immersive && <PhoneView />}
      <div className="cinematic-hud">
        <div><span>MARKET RITUAL / CINEMATIC</span><b>{scene.seed}</b></div>
        <div className="cinematic-presets">
          {(['archive','liquid','crash'] as const).map((preset) => <button key={preset} className={scene.preset === preset ? 'active' : ''} onClick={() => onPreset(preset)}>{preset}</button>)}
        </div>
        <button onClick={onToggleSound}>{sound ? 'SOUND ON' : 'ENABLE SOUND'}</button>
        {onExit && <button onClick={onExit}>EXIT CINEMA ×</button>}
      </div>
    </section>
  );
}
