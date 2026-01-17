<script>
	import { Canvas } from '@threlte/core';
	import BlackholeScene from '$lib/components/BlackholeScene.svelte';
	import { T } from '@threlte/core';
</script>

<div class="h-screen w-full overflow-hidden bg-black">
	<Canvas>
		<T.PerspectiveCamera makeDefault position={[0, 0, 5]} fov={75}></T.PerspectiveCamera>

		<BlackholeScene />
	</Canvas>
</div>
