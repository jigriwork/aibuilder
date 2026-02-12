import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { useRef } from "react";
import SceneFromSpec from "./SceneFromSpec";
import PlayerController from "./PlayerController";
import CameraController from "./CameraController";
import RuleSystem from "./RuleSystem";

export default function GameViewport({ gameSpec, onGameStateChange, onCountdownChange }) {
  const playerBodyRef = useRef(null);
  const sceneSpec = gameSpec?.scene || null;

  return (
    <Canvas
      camera={{
        position: Array.isArray(gameSpec?.camera?.position) ? gameSpec.camera.position : [7, 6, 7],
        fov: 50,
      }}
    >
      <color attach="background" args={["#0f172a"]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[5, 8, 4]} intensity={1.1} castShadow />

      <Physics gravity={[0, -9.81, 0]}>
        <SceneFromSpec sceneSpec={sceneSpec} />
        {gameSpec?.player ? (
          <PlayerController playerSpec={gameSpec.player} playerBodyRef={playerBodyRef} />
        ) : null}
        <RuleSystem
          gameSpec={gameSpec}
          playerBodyRef={playerBodyRef}
          onGameStateChange={onGameStateChange}
          onCountdownChange={onCountdownChange}
        />
      </Physics>

      <CameraController cameraSpec={gameSpec?.camera} playerBodyRef={playerBodyRef} />
    </Canvas>
  );
}
