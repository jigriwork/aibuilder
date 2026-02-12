import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";

export default function CameraController({ cameraSpec, playerBodyRef }) {
  const { camera } = useThree();
  const controlsRef = useRef(null);

  const mode = cameraSpec?.mode === "follow" ? "follow" : "orbit";
  const basePosition = Array.isArray(cameraSpec?.position) ? cameraSpec.position : [8, 7, 8];
  const followOffset = Array.isArray(cameraSpec?.followOffset) ? cameraSpec.followOffset : [0, 4, 8];
  const target = Array.isArray(cameraSpec?.target) ? cameraSpec.target : [0, 0, 0];

  const tempTarget = useMemo(() => new THREE.Vector3(), []);
  const desiredPosition = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    camera.position.set(basePosition[0], basePosition[1], basePosition[2]);
    camera.lookAt(target[0], target[1], target[2]);
    if (controlsRef.current) {
      controlsRef.current.target.set(target[0], target[1], target[2]);
      controlsRef.current.update();
    }
  }, [camera, basePosition, target, mode]);

  useFrame(() => {
    if (mode !== "follow") {
      return;
    }

    const body = playerBodyRef?.current;
    if (!body) {
      return;
    }

    const position = body.translation();
    tempTarget.set(position.x, position.y, position.z);
    desiredPosition.set(
      position.x + followOffset[0],
      position.y + followOffset[1],
      position.z + followOffset[2],
    );

    camera.position.lerp(desiredPosition, 0.1);
    camera.lookAt(tempTarget);
  });

  if (mode === "follow") {
    return null;
  }

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={target}
      minPolarAngle={0.3}
      maxPolarAngle={1.45}
      minDistance={3}
      maxDistance={22}
    />
  );
}
