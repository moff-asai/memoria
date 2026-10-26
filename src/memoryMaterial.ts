import * as THREE from "three"

/** Subtle variations of the theme's bubble color, stable for each memory ID. */
export function createMemoryMaterials(base: THREE.Color, key: string) {
  let hash = 2166136261
  for (const char of key) {
    hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0
  }
  // Mix neighbouring IDs so their hues do not cluster together.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  hash = (hash ^ (hash >>> 16)) >>> 0
  const hsl = base.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace)
  const color = new THREE.Color().setHSL(
    hsl.h + ((hash & 65535) / 65535 - 0.5) * 0.24,
    THREE.MathUtils.clamp(hsl.s + (((hash >>> 8) % 101) / 100 - 0.5) * 0.06, 0, 1),
    THREE.MathUtils.clamp(hsl.l + (((hash >>> 16) % 101) / 100 - 0.5) * 0.02, 0, 1),
    THREE.SRGBColorSpace,
  )
  const time = { value: 0 }
  const phase = { value: (hash / 0xffffffff) * Math.PI * 2 }
  const material = new THREE.MeshPhysicalMaterial({
    color,
    roughness: 0.12,
    metalness: 0,
    ior: 1.33,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    iridescence: 1,
    iridescenceIOR: 1.33,
    iridescenceThicknessRange: [180, 520],
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
  })
  // View-space film and reflections work for each eye, without tinting the photos.
  // Both materials share this memory's film clock, but keep independent opacity.
  material.onBeforeCompile = (shader) => {
    shader.uniforms.bubbleTime = time
    shader.uniforms.bubblePhase = phase
    shader.fragmentShader = `
      uniform float bubbleTime;
      uniform float bubblePhase;
    ` + shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `
        float facing = abs(dot(normal, normalize(vViewPosition)));
        float rim = pow(1.0 - clamp(facing, 0.0, 1.0), 2.0);
        float azimuth = atan(normal.y, normal.x);
        float filmBand = facing * 7.0
          + sin(azimuth * 2.0 + bubbleTime * 0.12) * 0.7
          - bubbleTime * 0.15 + bubblePhase;
        vec3 rainbow = 0.58 + 0.42 * cos(filmBand + vec3(0.0, 2.094, 4.188));
        vec3 filmTint = mix(diffuseColor.rgb, rainbow, 0.5);
        float crescent = pow(max(dot(
          normalize(normal.xy + vec2(0.0001)),
          normalize(vec2(-0.6, 0.8))
        ), 0.0), 8.0) * smoothstep(0.15, 0.9, rim);
        float glint = pow(max(dot(
          normal, normalize(vec3(-0.45, 0.6, 0.9))
        ), 0.0), 100.0);
        outgoingLight = mix(outgoingLight, filmTint, rim * 0.48);
        outgoingLight += vec3(0.8) * glint + vec3(0.22) * crescent;
        diffuseColor.a *= clamp(
          mix(0.025, 0.86, rim) + glint * 0.6 + crescent * 0.16, 0.0, 1.0
        );
        #include <opaque_fragment>
      `,
    )
  }
  // Only this memory's empty fragments fade back when its ring opens.
  const paleMaterial = material.clone()
  paleMaterial.onBeforeCompile = material.onBeforeCompile
  return {
    material,
    paleMaterial,
    update: (elapsed: number) => { time.value = elapsed },
  }
}
