import { RigidBody } from "@react-three/rapier";

function Ground({ position = [0, -0.5, 0], size = [12, 1, 12], color = "#3b82f6" }) {
  return (
    <RigidBody type="fixed" colliders="cuboid" position={position}>
      <mesh receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} />
      </mesh>
    </RigidBody>
  );
}

function Box({ position = [0, 3, 0], size = [1, 1, 1], color = "#f59e0b" }) {
  return (
    <RigidBody colliders="cuboid" position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} />
      </mesh>
    </RigidBody>
  );
}

function Sphere({ position = [0, 4, 0], radius = 0.7, color = "#ef4444" }) {
  return (
    <RigidBody colliders="ball" position={position}>
      <mesh castShadow receiveShadow>
        <sphereGeometry args={[radius, 32, 32]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </RigidBody>
  );
}

function Ramp({
  position = [0, 0.25, 0],
  size = [4, 0.5, 2],
  rotation = [0, 0, 0],
  color = "#64748b",
}) {
  return (
    <RigidBody type="fixed" colliders="cuboid" position={position} rotation={rotation}>
      <mesh receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial color={color} />
      </mesh>
    </RigidBody>
  );
}

export default function SceneFromSpec({ sceneSpec }) {
  const objects = sceneSpec?.objects;

  if (!objects || objects.length === 0) {
    return <Ground />;
  }

  return (
    <>
      {objects.map((object, index) => {
        const key = `${object.type}-${index}`;

        if (object.type === "ground") {
          return (
            <Ground
              key={key}
              position={object.position}
              size={object.size}
              color={object.color}
            />
          );
        }

        if (object.type === "box") {
          return (
            <Box
              key={key}
              position={object.position}
              size={object.size}
              color={object.color}
            />
          );
        }

        if (object.type === "sphere") {
          return (
            <Sphere
              key={key}
              position={object.position}
              radius={object.radius}
              color={object.color}
            />
          );
        }

        if (object.type === "ramp") {
          return (
            <Ramp
              key={key}
              position={object.position}
              size={object.size}
              rotation={object.rotation}
              color={object.color}
            />
          );
        }

        return null;
      })}
    </>
  );
}
