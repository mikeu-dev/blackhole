<script lang="ts">
	import { T, useTask, useThrelte, useLoader } from '@threlte/core';
	import {
		DoubleSide,
		ShaderMaterial,
		Vector2,
		Vector3,
		TextureLoader,
		RepeatWrapping,
		type Texture
	} from 'three';
	import { vertexShader, fragmentShader } from '../shaders/blackhole';
	import { onMount } from 'svelte';

	let time = 0;

	const { camera, renderer } = useThrelte();

	// Load Texture
	const texture = useLoader(TextureLoader).load('/textures/accretion_disk.png', {
		transform: (tex) => {
			tex.wrapS = RepeatWrapping;
			tex.wrapT = RepeatWrapping;
			return tex;
		}
	});

	const uniforms = {
		uTime: { value: 0 },
		uResolution: { value: new Vector2(1, 1) },
		uCameraPos: { value: new Vector3() },
		uCameraDir: { value: new Vector3() },
		uCameraUp: { value: new Vector3() },
		uDiskTexture: { value: null as Texture | null },
		uSpin: { value: 0.95 }
	};

	useTask((delta) => {
		time += delta;
		uniforms.uTime.value = time;

		if ($texture && !uniforms.uDiskTexture.value) {
			uniforms.uDiskTexture.value = $texture;
		}

		// Update camera vectors
		const cam = camera.current;
		if (cam) {
			uniforms.uCameraPos.value.copy(cam.position);

			// Get direction
			const dir = new Vector3();
			cam.getWorldDirection(dir);
			uniforms.uCameraDir.value.copy(dir);

			uniforms.uCameraUp.value.copy(cam.up);

			// Update resolution
			const canvas = renderer.domElement;
			uniforms.uResolution.value.set(canvas.width, canvas.height);
		}
	});
</script>

<!-- We render a plane in front of the camera or just a standalone object -->
<T.Mesh>
	<T.PlaneGeometry args={[10, 10]} />
	<T.ShaderMaterial {vertexShader} {fragmentShader} {uniforms} side={DoubleSide} transparent />
</T.Mesh>
