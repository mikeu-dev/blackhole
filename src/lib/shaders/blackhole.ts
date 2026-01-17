export const vertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

export const fragmentShader = `
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uCameraPos;
uniform vec3 uCameraDir;
uniform vec3 uCameraUp;
uniform sampler2D uDiskTexture;
uniform float uSpin; // 0.0 to 1.0 (approx)

varying vec2 vUv;

// --- CONSTANTS ---
const float PI = 3.14159265359;
const float PI2 = 6.28318530718;

// Simulation Units
// Mass M = 1.0. 
// Kerr Horizon Rh = M + sqrt(M^2 - a^2).
// For a=0.9, Rh ~ 1.45.
// ISCO Prograde ~ 2.32 M
// ISCO Retrograde ~ 8.7 M
// We visualize a disk from ~2.6 to 19.0 for aesthetics.

const float DISC_INNER = 2.6;
const float DISC_OUTER = 19.0;
const int MAX_STEPS = 140; 
const float MAX_DIST = 60.0;

// High-Contrast Starfield
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}
vec3 getStarfield(vec3 dir) {
    float n = hash(dir.xy * 800.0 + dir.z * 300.0);
    float stars = step(0.999, n) * (n - 0.999) * 2000.0; // Sparse but bright
    return vec3(stars);
}

// --- PHYSICS ---

// Approximated "Frame Dragging" Geodesic Acceleration
// We simulate the effect of spin by adding a "twisting" force
// and modifying the effective radial pull based on angular momentum alignment.
vec3 getKerrAccel(vec3 p, vec3 v, float h2) {
    float r2 = dot(p, p);
    float r = sqrt(r2);
    
    // Schwarzschild Base Term
    vec3 accel = -1.5 * 2.0 * h2 * p / (r2 * r2 * r);
    
    // Frame Dragging (Lense-Thirring effect approx)
    // Drag velocity ~ 1/r^3 in phi direction
    // We add a tangential acceleration
    vec3 spinAxis = vec3(0.0, 1.0, 0.0);
    vec3 dragDir = cross(spinAxis, p); // Tangential
    // Strength proportional to spin * 1/r^4 ?
    float dragStrength = uSpin * 2.0 / (r2 * r2);
    accel += dragDir * dragStrength;

    return accel;
}

// --- DISK SAMPLING ---
vec4 sampleDiskTexture(vec3 p, float r) {
    if (r < DISC_INNER || r > DISC_OUTER) return vec4(0.0);
    
    // Texture Mapping
    // U = Angle / 2PI
    // V = (r - Inner) / (Outer - Inner)
    
    float angle = atan(p.z, p.x); // -PI to PI
    float u = angle / PI2 + 0.5 + uTime * 0.05 * (10.0/r); // Rotate based on radius
    float v = (r - DISC_INNER) / (DISC_OUTER - DISC_INNER);
    
    // Sample texture
    vec3 texCol = texture2D(uDiskTexture, vec2(u, v)).rgb;
    
    // Enhance HDR
    texCol = pow(texCol, vec3(2.2)); // Gamma correction / Contrast
    texCol *= 4.0; // Boost brightness
    
    // Alpha/Density derived from brightness
    float brightness = dot(texCol, vec3(0.33));
    float alpha = smoothstep(0.1, 0.8, brightness);
    
    // Soft edges
    float thickness = 0.05 * (1.0 + r/10.0);
    alpha *= (1.0 - smoothstep(0.0, thickness, abs(p.y)));
    
    return vec4(texCol, alpha);
}

void main() {
    // 1. Setup
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= uResolution.x / uResolution.y;
    
    vec3 ro = uCameraPos;
    vec3 camFwd = normalize(uCameraDir);
    vec3 camUpVec = normalize(uCameraUp);
    vec3 camRight = cross(camFwd, camUpVec);
    vec3 rd = normalize(camFwd + uv.x * camRight + uv.y * camUpVec);

    vec3 p = ro;
    vec3 v = rd;
    
    vec3 hVec = cross(p, v);
    float h2 = dot(hVec, hVec);
    
    // Check initial spin alignment for Shadow D-shape heuristic
    // If ray is on left (moving with spin), it can get closer.
    // spin is Y axis.
    // Ray impact parameter on X axis determines side.
    // Simplified: Shadow is offset.
    
    vec3 col = vec3(0.0);
    vec3 transmittance = vec3(1.0);
    float bloom = 0.0;
    float dt = 0.5;
    
    // Horizon Radius approx for a=0.95
    float rh = 1.35; 
    
    // 2. Integration
    for(int i=0; i<MAX_STEPS; i++) {
        float r2 = dot(p, p);
        float r = sqrt(r2);
        
        // --- Horizon Check (D-Shape Heuristic) ---
        // Effective capture radius depends on impact parameter.
        // For equatorial ray:
        // b_critical (prograde) ~ 2 M (normalized)
        // b_critical (retrograde) ~ 7 M
        // We simulate this by warping the 'r' check or the limit.
        // Or simply: visual event horizon is defined by the Photon Capture region.
        // We let the ray fall in.
        if (r < rh) {
            break; // Absorbed
        }
        
        if (r > MAX_DIST) {
            col += transmittance * getStarfield(v);
            break;
        }
        
        // Bloom
        float dRing = abs(r - 2.8); // Photon sphere approx
        bloom += 0.05 / (dRing * dRing + 0.1); 

        // Step
        dt = max(0.02, r * 0.05);
        if(abs(p.y) < 0.5 && r < DISC_OUTER + 1.0) dt = min(dt, 0.05);
        
        // RK4 Integration with Kerr Accel
        vec3 k1v = getKerrAccel(p, v, h2);
        vec3 p2 = p + v * dt * 0.5;
        vec3 v2 = v + k1v * dt * 0.5;
        
        vec3 k2v = getKerrAccel(p2, v2, h2);
        vec3 p3 = p + v2 * dt * 0.5;
        vec3 v3 = v + k2v * dt * 0.5;
        
        vec3 k3v = getKerrAccel(p3, v3, h2);
        vec3 p4 = p + v3 * dt;
        vec3 v4 = v + k3v * dt;
        
        vec3 k4v = getKerrAccel(p4, v4, h2);
        
        p += (v + 2.0*v2 + 2.0*v3 + v4) * (dt / 6.0);
        v += (k1v + 2.0*k2v + 2.0*k3v + k4v) * (dt / 6.0);
        v = normalize(v);
        
        // --- Texture Sampling ---
        float mr = length(p);
        if(mr < DISC_OUTER && mr > DISC_INNER && abs(p.y) < 0.1) {
             vec4 data = sampleDiskTexture(p, mr);
             if(data.a > 0.01) {
                 // Relativistic Beaming
                 vec3 tanVec = normalize(cross(vec3(0,1,0), p));
                 float alignment = dot(tanVec, v); 
                 
                 // Smooth Doppler
                 float beaming = pow(1.0 - alignment * 0.7, 4.0); // Extreme Beaming
                 
                 // Redshift Tint (Smooth)
                 vec3 blue = vec3(0.9, 0.95, 1.0);
                 vec3 red = vec3(1.0, 0.4, 0.1);
                 float shift = 0.5 - 0.5 * alignment;
                 vec3 tint = mix(red, blue, shift);
                 
                 vec3 emission = data.rgb * beaming * tint * 2.5;
                 
                 float stepDens = data.a * dt * 5.0;
                 col += transmittance * emission * stepDens;
                 transmittance *= (1.0 - stepDens);
                 
                 if(transmittance.x < 0.01) break;
             }
        }
    }
    
    // Bloom Composite
    col += vec3(0.8, 0.6, 0.3) * bloom * 0.002;
    
    // Tone Mapping
    col = col / (col + vec3(1.0)); // Reinhard simple for stability
    col = pow(col, vec3(1.0/2.2)); // Gamma
    
    gl_FragColor = vec4(col, 1.0);
}
`;
