<script lang="ts">
  import { T, useFrame } from '@threlte/core';
  import { DoubleSide, ShaderMaterial, Vector2, Vector3 } from 'three';
  import { vertexShader, fragmentShader } from '../shaders/blackhole';

  let time = 0;
  let mass = 1.0; 

  const uniforms = {
    uTime: { value: 0 },
    uResolution: { value: new Vector2(1, 1) }, // Will be updated
    uCameraPos: { value: new Vector3(0, 0, 5) },
    uMass: { value: mass }
  };

  useFrame((state) => {
    time += state.delta;
    uniforms.uTime.value = time;
    // Update camera position logic if moving the camera not the mesh
    uniforms.uCameraPos.value.copy(state.camera.current.position);
    
    // Naive resolution update (should handle resize properly in real app)
    // uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  });

</script>

<!-- We render a plane in front of the camera or just a standalone object -->
<T.Mesh>
  <T.PlaneGeometry args={[10, 10]} />
  <T.ShaderMaterial
    {vertexShader}
    {fragmentShader}
    {uniforms}
    side={DoubleSide}
    transparent
  />
</T.Mesh>
