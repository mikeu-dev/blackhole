export const vertexShader = `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const fragmentShader = `
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uCameraPos;
uniform float uMass;

varying vec2 vUv;

#define MAX_STEPS 128
#define MAX_DIST 50.0
#define SURF_DIST 0.01

// Helper functions for Noise
float hash(vec2 p) { return fract(1e4 * sin(17.0 * p.x + p.y * 0.1) * (0.1 + abs(sin(p.y * 13.0 + p.x)))); }
float noise(vec2 x) {
    vec2 i = floor(x);
    vec2 f = fract(x);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 x) {
    float v = 0.0;
    float a = 0.5;
    vec2 shift = vec2(100);
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.50));
    for (int i = 0; i < 5; ++i) {
        v += a * noise(x);
        x = rot * x * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

vec3 getRayDirection(vec2 uv, vec3 camPos, vec3 lookAt, float fov) {
    vec3 forward = normalize(lookAt - camPos);
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
    vec3 up = cross(forward, right);
    return normalize(forward + fov * (uv.x * right + uv.y * up));
}

// Accretion Disk Physics
// Returns color and alpha
vec4 sampleDisk(vec3 p, float distToCenter) {
    // Disk lies on XZ plane (y approx 0), but let's give it some volume
    float thickness = 0.1 + distToCenter * 0.05;
    if (abs(p.y) > thickness) return vec4(0.0);
    
    // Bounds of the disk
    float innerR = 3.0 * uMass; // ISCO (Innermost Stable Circular Orbit) mostly
    float outerR = 12.0 * uMass;
    
    float r = length(p.xz);
    if (r < innerR || r > outerR) return vec4(0.0);

    // Coordinate for noise looking up
    float angle = atan(p.z, p.x);
    // Spiral rotation
    float speed = 2.0 / (r * r + 0.1); // Keplerian-ish speed
    float rotAngle = angle + uTime * speed; 
    
    vec2 uvMap = vec2(r, rotAngle * 2.0); // Coordinate mapping
    
    float dens = fbm(uvMap * 3.0);
    
    // Temperature gradient: hotter inside
    float temp = 1.0 - smoothstep(innerR, outerR, r);
    
    // Color Ramp based on temperature
    vec3 colorHot = vec3(1.0, 0.9, 0.5); // Whitish yellow
    vec3 colorCold = vec3(0.8, 0.3, 0.1); // Orange red
    vec3 col = mix(colorCold, colorHot, temp * dens);
    
    // Doppler Beaming (Relativistic Boosting)
    // Matter moves roughly perpendicular to radius. 
    // Approaching (Blueshift): Left side if rotating CCW and viewed from top?
    // Let's assume simplified view vector dot velocity vector logic.
    // Velocity vector at p: Tangent to circle.
    vec3 velIdx = normalize(vec3(-p.z, 0.0, p.x)); // Circular motion tangent
    // We don't have true view dir here easily without passing it, but 'p' itself 
    // relative to camera implies direction if camera is at +Z.
    // Simple heuristic: boost brightness based on X position for a tilted view
    float doppler = 1.0 + 0.5 * dot(normalize(p), vec3(-1.0, 0.0, 0.0)); // Fake factor
    // Better heuristic:
    // If disk is on XZ, and we look from +Z +Y, the left side (negative x) is coming at us?
    // Let's just use x coordinate to simulate the shift.
    // X < 0 : coming towards -> Brighter, Bluer
    // X > 0 : going away -> Dimmer, Redder
    float factor = -p.x / (r + 0.1); // -1 to 1 approx
    
    col *= (1.0 + factor * 0.8); // Intensity modulation
    
    // Shift color (Redshift/Blueshift)
    // Blueshift (factor > 0) -> Add Blue
    if(factor > 0.0) col += vec3(0.0, 0.1, 0.2) * factor;
    // Redshift (factor < 0) -> Add Red, remove Blue
    if(factor < 0.0) col *= vec3(1.0, 0.8, 0.5);

    return vec4(col, dens * temp * 2.0); // Premultiplied alpha ish
}

void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    // Aspect correction? Assuming square plane for now or handled by Three.js
    
    vec3 ro = uCameraPos; 
    vec3 target = vec3(0.0, 0.0, 0.0);
    vec3 rd = getRayDirection(uv, ro, target, 1.0); // FOV 1.0

    vec3 col = vec3(0.0);
    float d = 0.0;
    vec3 p = ro;
    
    vec3 accumCol = vec3(0.0);
    float accumDens = 0.0;
    
    for(int i=0; i<MAX_STEPS; i++) {
        p = ro + rd * d;
        float r = length(p);
        
        // Event Horizon
        float rs = 2.0 * uMass;
        if(r < rs + SURF_DIST) {
            accumCol = vec3(0.0); // Shadow
            break; 
        }
        if(d > MAX_DIST) break;
        
        // Gravity Lensing (Bend RD)
        if(r > rs) {
            float bend = (rs * 0.5) / (r * r); // Heuristic bending strength
            vec3 toCenter = normalize(-p);
            rd = normalize(rd + toCenter * bend * 0.2); 
        }

        // Accretion Disk Sampling (Volumetric Raymarching)
        // Check if we are close to the disk plane
        if(abs(p.y) < 2.0) { // Optimize: only sample near plane
             vec4 diskSample = sampleDisk(p, r);
             if(diskSample.a > 0.01) {
                 float stepAlpha = diskSample.a * 0.1; // Density * Step
                 accumCol += diskSample.rgb * stepAlpha * (1.0 - accumDens);
                 accumDens += stepAlpha;
                 if(accumDens > 0.98) break; // Opaque
             }
        }
        
        // Step size
        float step = max(0.05, r * 0.1); // Adaptive step
        if(accumDens > 0.01) step = 0.05; // Scrutinize disk
        d += step;
    }
    
    // Background stars (if not fully occluded)
    if(accumDens < 1.0) {
        float stars = pow(hash(rd.xy * 100.0), 20.0);
        vec3 bg = vec3(stars);
        accumCol += bg * (1.0 - accumDens);
    }

    gl_FragColor = vec4(accumCol, 1.0);
}
`;
