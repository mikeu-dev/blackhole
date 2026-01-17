export const vertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
}
`;

export const fragmentShader = `
precision highp float;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uCameraPos;
uniform vec3 uCameraDir;
uniform vec3 uCameraUp;
uniform float uSpin; 

varying vec2 vUv;

// --- CONSTANTS ---
const float PI = 3.14159265359;
const int MAX_STEPS = 65; // Optimized for laptop (prev 100)
const float MAX_DIST = 40.0;
const float STEP_SIZE = 0.08; // Larger steps (prev 0.05)

// --- NOISE ---
// Generates a starfield and subtle nebula
float hash(vec3 p) {
    p = fract(p * 0.3183099 + .1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    // Reduced to 2 octaves for inner loop performance
    for (int i = 0; i < 2; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

vec3 getBackground(vec3 dir) {
    float n = hash(dir * 200.0);
    // Cheap starfield
    float stars = step(0.998, n) * (n-0.998) * 500.0;
    
    // Nebula (keep it simple outside loop)
    float neb = noise(dir * 2.0); 
    vec3 nebCol = vec3(0.02, 0.03, 0.06) * neb * 0.5;
    
    return vec3(stars) + nebCol;
}

// --- PHYSICS & DISK ---

// Color Mapping (Blackbody-ish)
vec3 getDiskColor(float t) {
    // Optimized gradient: Orange -> White
    return mix(vec3(1.0, 0.1, 0.0), vec3(1.0, 1.0, 0.8), t);
}

// Disk Sampling
vec4 sampleDisk(vec3 p, float r) {
    // Quick Bounding Box Check
    if (abs(p.y) > 0.8) return vec4(0.0); // Tighter height check
    
    // Disk Geometry
    float inner = 2.6;
    float outer = 14.0;
    
    if (r < inner || r > outer) return vec4(0.0);
    
    // Density falloff
    float density = 1.0 - smoothstep(0.0, 0.8, abs(p.y)); // Simplified height
    density *= smoothstep(inner, inner+1.0, r);
    density *= 1.0 - smoothstep(outer-2.0, outer, r);
    
    if (density < 0.01) return vec4(0.0);
    
    // Vortex Pattern
    // Use lower quality noise for performance
    float ang = atan(p.z, p.x);
    float swirl = 8.0 / max(r, 0.1);
    float u = ang + swirl + uTime * (2.0 / max(r, 1.0));
    
    // Single noise sample instead of FBM for inner loop
    float n = noise(vec3(r * 1.5, u * 1.5, p.y * 4.0));
    n = smoothstep(0.3, 0.7, n);
    
    // Color
    float temp = 1.0 - smoothstep(inner, outer, r);
    temp += n * 0.3;
    vec3 col = getDiskColor(clamp(temp * 1.2, 0.0, 1.0)); // Boost brightness slightly
    
    float alpha = density * n * 0.6;
    return vec4(col * 2.5, alpha);
}

void main() {
    // Normalize coordinates
    vec2 uv = vUv * 2.0 - 1.0;
    uv.x *= uResolution.x / uResolution.y;
    
    // Dynamic Resolution Scaling (Optional: manually downscale ray count logic if we could)
    // For now we rely on larger steps.
    
    vec3 ro = uCameraPos;
    vec3 camFwd = normalize(uCameraDir);
    vec3 camUp = normalize(uCameraUp);
    vec3 camRight = cross(camFwd, camUp);
    vec3 rd = normalize(camFwd + uv.x * camRight + uv.y * camUp);
    
    vec3 p = ro;
    vec3 v = rd;
    
    vec3 col = vec3(0.0);
    vec3 transmittance = vec3(1.0);
    
    // Ray Marching
    for(int i=0; i<MAX_STEPS; i++) {
        float r2 = dot(p,p);
        float r = sqrt(r2);
        
        // Event Horizon
        if (r < 2.0) {
            col += vec3(0.0); 
            transmittance = vec3(0.0);
            break;
        }
        
        if (r > MAX_DIST) {
            col += transmittance * getBackground(v);
            break;
        }
        
        // Gravity (Newtonian approx)
        float rSafe = max(r, 0.5); // Increase safety margin
        vec3 acc = -1.5 * p / (rSafe * rSafe * rSafe); 
        
        // Adaptive Step
        float dt = max(STEP_SIZE, r * 0.08); // More aggressive stepping at distance
        if (abs(p.y) < 1.0 && r < 15.0) dt = 0.06; // Slower near disk
        
        v += acc * dt;
        v = normalize(v);
        p += v * dt;
        
        // Disk Accumulation
        if (abs(p.y) < 0.8 && r < 14.0 && r > 2.5) {
             vec4 samp = sampleDisk(p, r);
             if (samp.a > 0.01) {
                 float stepDens = samp.a * dt;
                 col += transmittance * samp.rgb * stepDens;
                 transmittance *= (1.0 - stepDens);
                 if (transmittance.x < 0.05) break; // Early exit earlier
             }
        }
    }
    
    // Tone Mapping (Reinhard)
    col = col / (col + vec3(1.0));
    col = pow(col, vec3(1.0/2.2));
    
    gl_FragColor = vec4(col, 1.0);
}
`;
