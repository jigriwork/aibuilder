import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody } from "@react-three/rapier";

const PLAYER_KEYS = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " "];

export default function PlayerController({ playerSpec, playerBodyRef }) {
  const internalRef = useRef(null);
  const keyState = useRef({});
  const bodyRef = playerBodyRef || internalRef;

  const kind = playerSpec?.kind === "box" ? "box" : "sphere";
  const spawn = Array.isArray(playerSpec?.spawn) ? playerSpec.spawn : [0, 2, 0];
  const speed = Number(playerSpec?.move?.speed) > 0 ? Number(playerSpec.move.speed) : 5;
  const jumpEnabled = playerSpec?.jump?.enabled !== false;
  const jumpStrength = Number(playerSpec?.jump?.strength) > 0 ? Number(playerSpec.jump.strength) : 5;

  useEffect(() => {
    const onKeyDown = (event) => {
      const key = event.key.toLowerCase();
      if (PLAYER_KEYS.includes(key)) {
        keyState.current[key] = true;
      }
    };

    const onKeyUp = (event) => {
      const key = event.key.toLowerCase();
      if (PLAYER_KEYS.includes(key)) {
        keyState.current[key] = false;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useFrame(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }

    const velocity = body.linvel();
    const keys = keyState.current;

    let moveX = 0;
    let moveZ = 0;

    if (keys.w || keys.arrowup) moveZ -= 1;
    if (keys.s || keys.arrowdown) moveZ += 1;
    if (keys.a || keys.arrowleft) moveX -= 1;
    if (keys.d || keys.arrowright) moveX += 1;

    const magnitude = Math.hypot(moveX, moveZ) || 1;
    const nextX = (moveX / magnitude) * speed;
    const nextZ = (moveZ / magnitude) * speed;

    body.setLinvel({ x: nextX, y: velocity.y, z: nextZ }, true);

    if (jumpEnabled && keys[" "] && Math.abs(velocity.y) < 0.08) {
      body.applyImpulse({ x: 0, y: jumpStrength, z: 0 }, true);
    }
  });

  const mesh = useMemo(() => {
    if (kind === "box") {
      return (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[0.9, 0.9, 0.9]} />
          <meshStandardMaterial color="#22d3ee" />
        </mesh>
      );
    }

    return (
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial color="#22d3ee" />
      </mesh>
    );
  }, [kind]);

  return (
    <RigidBody ref={bodyRef} colliders={kind === "box" ? "cuboid" : "ball"} position={spawn}>
      {mesh}
    </RigidBody>
  );
}
