// https://threejs.org/docs/index.html#api/en/materials/ShaderMaterial
// https://threejs.org/docs/#api/en/renderers/webgl/WebGLProgram -- cameraPosition matrices etc...
// https://webglfundamentals.org/webgl/lessons/webgl-shaders-and-glsl.html
// https://www.khronos.org/files/opengles_shading_language.pdf
// https://registry.khronos.org/OpenGL/specs/es/2.0/GLSL_ES_Specification_1.00.pdf // For WebGL

// Data texture
// https://codepen.io/prisoner849/pen/WNQNdpv?editors=0010

// Ben Cloward has some interesting tutorials with Unreal Engine on how to make water effects, but they are not explained
// UE Ocean using texture https://www.youtube.com/watch?v=r68DnTMeFFQ&list=PL78XDi0TS4lGXKflD2Z5aY2sLuIln6-sD&ab_channel=BenCloward
// Adding a Gestner wave to that https://www.youtube.com/watch?v=BJSMVvZMQ1w&ab_channel=BenCloward

// Gestner waves tutorial
// https://catlikecoding.com/unity/tutorials/flow/waves/

// 2D water effect
// https://brandenstrochinsky.blogspot.com/2016/06/water-effect.html
// Screen space reflections (SSR)
// https://www.youtube.com/watch?v=K2rs7K4y_sY&ab_channel=NullPointer
// https://threejs.org/examples/?q=ssr#webgl_postprocessing_ssr
// https://threejs.org/examples/jsm/shaders/SSRShader.js
// Depth
// https://discourse.threejs.org/t/get-depth-in-fragment-shader/1831
// Mirror reflection
// http://www.shiplab.hials.org/app/simulator/Elias/

// Blending normals
// https://blog.selfshadow.com/publications/blending-in-detail/

// Foam
// RenderToTarget the displacement. Use it to create a foam texture and particles
// https://www.youtube.com/watch?v=UWGwq-_w08c&ab_channel=GhislainGirardot

// Read more about normal mapping
// https://www.youtube.com/watch?v=6_-NNKc4lrk&ab_channel=Makin%27StuffLookGood
// https://www.youtube.com/watch?v=JNj1A1bl7gg&ab_channel=VictorGordan

// GLSL OPTIMIZATIONS
// https://www.khronos.org/opengl/wiki/GLSL_Optimizations

// Use VS plugin "Comment tagged templates" and add /* glsl */
export const OceanProjectedGridVertShader = /* glsl */ `
        
  #define PI 3.141592653589793
  // Shortest wavelength drawn, relative to the distance to the camera (fades between MIN and MAX)
  #define ANTIALIAS_MIN 0.08
  #define ANTIALIAS_MAX 0.2
  precision lowp float;

  uniform float u_time;
  uniform vec3 u_imgSize;
  uniform sampler2D u_paramsTexture;
  uniform float u_steepnessFactor;

  uniform vec4 u_wave1Params;
  uniform vec4 u_wave2Params;

  // Grid reprojection
  uniform mat4 u_cameraModelMatrix;
  uniform vec3 u_cameraGridPosition;
  uniform vec2 u_cameraViewportScale;

  

  varying vec3 v_WorldPosition;
  varying vec3 v_Normal;
  varying mat3 v_TBN;
  varying vec4 v_OceanColor;
  // Wave height (displaced y), used for crest colour and foam
  varying float v_height;
  // SSR
  varying float v_distToCam;


  // Gerstner Wave
  // https://catlikecoding.com/unity/tutorials/flow/waves/
  vec3 GerstnerWave(
      vec4 waveParams, vec3 position, 
      inout vec3 tangent, inout vec3 binormal){

    float steepness = max(waveParams.x, 0.01);
    float amplitude = max(waveParams.y, 0.01) / 2.0;
    float wavelength = amplitude * 2.0 * PI / steepness;
    vec2 direction = waveParams.zw;

    // Anti-aliasing: fade out waves too short for the grid to draw at this distance.
    // Otherwise they alias into thin parallel stripes along the bigger waves
    float distToCamera = distance(position, cameraPosition);
    float aliasingFade = smoothstep(ANTIALIAS_MIN * distToCamera, ANTIALIAS_MAX * distToCamera, wavelength);
    amplitude *= aliasingFade;
    steepness *= aliasingFade;

    // Wave coefficient
    float k = 2.0 * PI / wavelength;
    // Velocity (related to gravity and wavelength)
    float velocity = sqrt(9.8 / k);
    
    // Normalize direction
    direction = normalize(direction);
    // Trochoidal wave movement
    float f = k * (dot(direction, position.xz) - velocity * u_time); // + randomPhase

    // Tangent
    tangent += vec3(
      -direction.x * direction.x * (steepness * sin(f)),
      direction.x * (steepness * cos(f)),
      -direction.x * direction.y * (steepness * sin(f))
    );

    // Binormal
    binormal += vec3(
      -direction.x * direction.y * (steepness * sin(f)),
      direction.y * (steepness * cos(f)),
      -direction.y * direction.y * (steepness * sin(f))
    );

    return vec3(
      direction.x * (amplitude * cos(f)),
      amplitude * sin(f),
      direction.y * (amplitude * cos(f))
    );

  }


  void main() {

    // ******************************** //
    // Grid reprojection
    // Scale the vertices to fall inside the viewport
    vec3 scaledPosition = position;
    scaledPosition.x = position.x * u_cameraViewportScale.x; // TODO EXTRA SCALING IF BIG WAVES?
    scaledPosition.y = position.y * u_cameraViewportScale.y; // TODO EXTRA SCALING (* 1.5?) IF BIG WAVES?

    // Move vertices in front of the camera
    vec3 worldPosFrontCamera = vec3(modelMatrix * vec4(scaledPosition, 1.0));

    // Project vertex in the XZ plane
    // Calculate intersection between plane and camera ray
    vec3 ray = normalize(worldPosFrontCamera - u_cameraGridPosition);
    // Ray is not parallel to the horizon
    float t = -1.0;
    if (ray.y != 0.0)
        t = (0.0 - u_cameraGridPosition.y) / ray.y;

    // Intersection point
    vec3 intersectionPoint = u_cameraGridPosition + ray * t;

    // HACK -> if cameraForward is opposite from ray direction, move intersection point on the opposite side
    // TODO: this method assumes that the camera is close to the center 0,0,0
    // Extract forward vector from camera
    mat3 orientationMatrix = mat3(u_cameraModelMatrix);
    vec3 forwardCameraVector = -orientationMatrix[2];
    vec3 ray2 = intersectionPoint - u_cameraGridPosition;
    float dotResult = dot(forwardCameraVector, ray2);
    if (dotResult < 0.0)
        intersectionPoint = intersectionPoint * -1.0;

    // ******************************** //


    // Get position
    vec3 modPos = intersectionPoint; // position;

    // Attenuate waves as they get further away from the camera (avoids artifacts on the horizon).
    // From the camera, not the buoy (0, 0, 0): away from the buoy (following a boat) the sea was flat
    float distanceToCenter = distance(cameraPosition.xz, intersectionPoint.xz);
    float distanceStart = 200.0;
    distanceToCenter = min(10000.0, max(distanceStart, distanceToCenter));
    float distanceFactor = max(0.0001, distanceStart/(distanceToCenter));

    // Declare tangent and binormal
    vec3 tangent = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);


    // Gerstner Waves
    modPos += GerstnerWave(u_wave1Params, modPos, tangent, binormal); 
    // Attenuation
    modPos.y *= distanceFactor;
    tangent.x /= distanceFactor;
    binormal.z /= distanceFactor;
    tangent = normalize(tangent);
    binormal = normalize(binormal);

    modPos += GerstnerWave(u_wave2Params, modPos, tangent, binormal);
    // Attenuation
    modPos.y *= distanceFactor;
    tangent.x /= distanceFactor;
    binormal.z /= distanceFactor;
    tangent = normalize(tangent);
    binormal = normalize(binormal);



    // Iterate over all the waves
    for (int i = 0; i < int(u_imgSize.x); i++){
      for (int j = 0; j < int(u_imgSize.y); j++){
        vec4 params = texture2D(u_paramsTexture, vec2(float(i)/u_imgSize.x, float(j)/u_imgSize.y));
        // Steepness factor
        params.r = params.r * u_steepnessFactor;
        // Wave height factor
        //params.g = params.g/(u_imgSize.x*u_imgSize.y);
        // Direction
        params.b = params.b - 0.5;
        params.a = params.a - 0.5;
        modPos += GerstnerWave(params, modPos, tangent, binormal);
        // Attenuation
        modPos.y *= distanceFactor;
        tangent.x /= distanceFactor;
        binormal.z /= distanceFactor;
        tangent = normalize(tangent);
        binormal = normalize(binormal);
      }
    }


    // Normal
    vec3 normal = normalize(cross(binormal, tangent));
    v_Normal = normalize(normal.xyz);
    v_height = modPos.y;

    // World position
    //vec4 worldPosition = modelMatrix * vec4(modPos, 1.0);
    //v_WorldPosition = worldPosition.xyz;
    v_WorldPosition = intersectionPoint;

    // Model
    v_TBN = mat3(tangent, binormal, normal);

    // Screen space position
    //gl_Position = projectionMatrix * modelViewMatrix * vec4(modPos, 1.0);
    gl_Position = projectionMatrix * viewMatrix * vec4(modPos, 1.0);

    // Depth from gl_Position
    v_distToCam = gl_Position.z;
  }
  `;












export const OceanProjectedGridFragShader = /* glsl */`

  precision mediump float; // lowp is too coarse for the sharp sun glint

  varying vec3 v_WorldPosition;
  varying vec3 v_Normal;
  varying mat3 v_TBN;
  varying float v_height;

  varying float v_distToCam;

  uniform sampler2D u_normalTexture;
  uniform lowp float u_time; // Same precision as in the vertex shader (required for shared uniforms)
  uniform lowp float u_steepnessFactor; // Grows with the wind (see Canvas3D.vue), drives the amount of foam
  uniform vec3 u_sunDirection;
  uniform vec3 u_sunColor;
  uniform float u_daylight;
  uniform vec3 u_skyTint;
  uniform vec2 u_windOffset;
  uniform float u_windStrength;
  uniform samplerCube u_reflectionMap;
  uniform float u_hasReflectionMap;
  // Fog
  uniform vec3 u_fogUnderwaterColor;
  uniform float u_fogDensity;

  //varying vec4 v_OceanColor;


  // https://github.com/dli/waves/blob/master/simulation.js
  vec3 hdr (vec3 color, float exposure) {
      return 1.0 - exp(-color * exposure);
  }

  // ACES filmic tone mapping (Narkowicz approximation): more contrast and natural highlights than hdr()
  // https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/
  vec3 acesToneMapping (vec3 color) {
      return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), 0.0, 1.0);
  }

  // Value noise, for the foam pattern. Hash without sine, which keeps precision in mediump
  // https://www.shadertoy.com/view/4djSRW
  float hash (vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
  }
  float valueNoise (vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                 mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float foamNoise (vec2 p) {
      return 0.6 * valueNoise(p) + 0.3 * valueNoise(p * 2.7 + 5.2) + 0.1 * valueNoise(p * 7.1 + 1.7);
  }



  void main(){

    // Bump texture for specular reflections (small ripples), sampled twice at different scales
    // and orientations and blended: alone, its 2 m tile shows as a regular grid in the glints
    // https://www.youtube.com/watch?v=6_-NNKc4lrk&ab_channel=Makin%27StuffLookGood
    // https://blog.selfshadow.com/publications/blending-in-detail/ (partial derivatives)
    // Both layers drift downwind, the larger one a bit slower, so the pattern also changes
    vec2 worldXZ = v_WorldPosition.xz;
    vec3 ripples1 = texture2D(u_normalTexture, (worldXZ - u_windOffset) / 2.3).xyz * 2.0 - 1.0;
    // Second layer turned ~37º and larger, its normals turned back to match
    vec3 ripples2 = texture2D(u_normalTexture, mat2(0.8, -0.6, 0.6, 0.8) * (worldXZ - u_windOffset * 0.7) / 5.9 + vec2(0.37, 0.71)).xyz * 2.0 - 1.0;
    ripples2.xy = mat2(0.8, 0.6, -0.6, 0.8) * ripples2.xy;
    vec2 ripplesSlope = ripples1.xy / max(ripples1.z, 0.2) * 0.6 + ripples2.xy / max(ripples2.z, 0.2) * 0.5;
    // Softer far away, where the tiles shrink into a fine pattern
    ripplesSlope *= mix(1.0, 0.45, smoothstep(25.0, 250.0, distance(v_WorldPosition, cameraPosition)));
    // Calm water is smoother, a strong wind roughens it
    ripplesSlope *= mix(0.55, 1.35, u_windStrength);
    // We are using Y as up, but for this calculation, Z must be used, as the multiplication in TBN follows this order:
    // Red(x) * tangent + Green(y) * bitangent + Blue (z) * normal
    // Probably I should change either the order in the TBN (e.g. tangent, normal, bitangent) or the order in the multiplication
    vec3 normalTextureValueZUp = normalize(vec3(ripplesSlope, 1.0));
    vec3 normal = normalTextureValueZUp.x * v_TBN[0] + normalTextureValueZUp.y * v_TBN[1] + normalTextureValueZUp.z * v_TBN[2];
    // Now the normal has xz as the horizontal plane and y as the vertical axis.

    // Normalize normals
    normal = normalize(normal); // Geometric normal + texture normal
    vec3 geoNormal = normalize(v_Normal); // Geometric normal


    // Normal blending - In case of having two normal maps. Normal blending is solved above using TBN
    // https://blog.selfshadow.com/publications/blending-in-detail/
    // Partial derivative blending
    //vec3 n1 = v_Normal;
    //vec3 n2 = normalTexel;
    //vec2 pd = n1.xy/n1.z + n2.xy/n2.z; // Add the PDs
    //vec3 normal  = normalize(vec3(pd, 1.0)); // Partial derivative
    //vec3 normal = normalize(vec3(n1.xy + n2.xy, n1.z*n2.z)); // Whiteout blending
    //vec3 normal = v_Normal;

    // Sun (direction towards the sun)
    vec3 sunDir = normalize(u_sunDirection);
    vec3 sunColor = u_sunColor;

    // Water colours: deep body and the turquoise light that passes through thin crests
    vec3 deepColor = vec3(0.004, 0.05, 0.12) * u_daylight;
    vec3 scatterColor = vec3(0.0, 0.40, 0.42) * u_daylight;

    // Sky colours for the reflection: pale at the horizon, deeper blue above
    vec3 skyHorizonColor = vec3(0.70, 0.85, 0.95) * u_skyTint;
    vec3 skyZenithColor = vec3(0.25, 0.50, 0.85) * u_skyTint;


    // Underwater factor (if camera is above or below water)
    float underwaterFactor = (abs(cameraPosition.y)/cameraPosition.y)*0.5 + 0.5;
    // Fog underwater (Fog exp 2)
    float fogDepth = distance(v_WorldPosition, cameraPosition);
    float fogDensity = u_fogDensity - u_fogDensity * 0.75 * underwaterFactor; // Lighter haze above water, so the horizon stays sharp
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );
    vec3 fogAirColor = vec3(0.8, 0.93, 1.0) * u_skyTint;
    vec3 fogColor = mix(u_fogUnderwaterColor, fogAirColor, underwaterFactor) ;

    
    // Direction from the surface to the camera
    vec3 viewDir = normalize(cameraPosition - v_WorldPosition);
    // Geometric normal with a bit of the small ripples, for the reflection/refraction split
    vec3 fresnelNormal = normalize(mix(geoNormal, normal, 0.4));

    // Fresnel (Schlick): grazing angles reflect the sky, steep angles show the water body
    // https://github.com/dli/waves/blob/master/simulation.js
    float fresnel = 0.02 + 0.98 * pow(1.0 - abs(dot(fresnelNormal, viewDir)), 5.0);
    fresnel = clamp(fresnel, 0.0, 1.0);

    // Sky reflection: gradient from horizon to zenith along the reflected ray
    vec3 reflectedRay = reflect(-viewDir, fresnelNormal); // Smoother normal, so the coastline shows in the reflection
    vec3 skyColor = mix(skyHorizonColor, skyZenithColor, pow(clamp(reflectedRay.y, 0.0, 1.0), 0.6));
    // Real sky and coastline, when the cubemap is ready. Rays pointing down are lifted to the horizon.
    // The cubemap is linear, while this shader works in display colours
    vec3 envRay = normalize(vec3(reflectedRay.x, max(reflectedRay.y, 0.01), reflectedRay.z));
    vec3 envColor = pow(textureCube(u_reflectionMap, envRay).rgb, vec3(1.0 / 2.2));
    skyColor = mix(skyColor, envColor, u_hasReflectionMap);

    // Water body: dark blue, lit a little by the sun
    float sunDiffuse = max(0.0, dot(geoNormal, sunDir));
    vec3 waterColor = deepColor * (0.6 + 0.8 * sunDiffuse);

    // Light through the crests (fake subsurface scattering): stronger on high waves
    // and when looking towards the sun, through the back of the wave
    float crest = smoothstep(-0.05, 0.35, v_height);
    float backLight = pow(clamp(dot(-viewDir, sunDir), 0.0, 1.0), 3.0);
    float facing = pow(1.0 - max(0.0, dot(geoNormal, viewDir)), 2.0); // wave faces seen side-on
    waterColor += scatterColor * crest * (0.25 + 0.75 * backLight) * (0.4 + 0.6 * facing);

    // Sun glint: a sharp highlight plus a broad soft sheen (Blinn-Phong)
    vec3 halfVector = normalize(sunDir + viewDir);
    float nDotH = max(0.0, dot(normal, halfVector));
    vec3 specularColor = sunColor * (6.0 * pow(nDotH, 600.0) + 0.25 * pow(nDotH, 60.0));

    vec3 color = mix(waterColor, skyColor * 1.3, fresnel) + specularColor;

    // Foam on the tips of the highest and steepest crests, more of it with more wind.
    // Drawn as lace (noise ridges) that fills in as coverage grows, and faded with distance to avoid flickering
    float slope = 1.0 - geoNormal.y;
    float foamMask = smoothstep(0.16, 0.34, v_height) * (0.4 + 0.6 * smoothstep(0.03, 0.2, slope));
    float windFoam = smoothstep(0.06, 0.3, u_steepnessFactor);
    float breaking = smoothstep(0.3, 0.75, valueNoise(v_WorldPosition.xz * 0.12)); // only some stretches of each crest break
    float coverage = foamMask * breaking * (0.3 + 0.7 * windFoam);
    float laceNoise = 0.7 * foamNoise(v_WorldPosition.xz * 3.0) + 0.3 * foamNoise(v_WorldPosition.xz * 9.0 + 3.1);
    float lace = 1.0 - abs(laceNoise * 2.0 - 1.0); // 1 on the noise ridges
    float foam = smoothstep(1.0 - coverage, 1.0 - coverage + 0.12, lace);
    foam *= 1.0 - smoothstep(40.0, 120.0, distance(v_WorldPosition, cameraPosition));
    vec3 foamColor = vec3(0.92, 0.96, 0.98) * (0.75 + 0.35 * sunDiffuse) * mix(u_skyTint, vec3(1.0), 0.3);
    color = mix(color, foamColor, foam * 0.8);

    color = acesToneMapping(color);

    // Add fog
    color = mix( color, fogColor, fogFactor );

    gl_FragColor = vec4(color, 0.9 + fogFactor*0.1);
    //gl_FragColor = vec4(skyFresnel + waterFresnel + diffuseColor + specularColor, 0.92);
    

    //gl_FragColor = vec4(skyFresnel, 1.0);
    //gl_FragColor = vec4(waterFresnel, 1.0);
    //gl_FragColor = vec4(dotOperation, dotOperation, dotOperation, 1.0);
    //gl_FragColor = vec4(fresnel, fresnel, fresnel, 1.0);


    //gl_FragColor = vec4(diffuseColor + specularColor + skyColor, 1.0);
    //gl_FragColor = vec4( specularColor + skyColor, 1.0);
    //gl_FragColor = vec4(diffuseColor + specularColor, 1.0);
    //gl_FragColor = vec4(v_OceanColor.rgb, 1.0);
    //gl_FragColor = vec4((temp.xzy + 1.0)/2.0, 1.0);
    //gl_FragColor = vec4((normalTexel.xyz + 1.0)/2.0, 1.0);
    //gl_FragColor = vec4(normal.xz*0.5 + 0.5, normal.y, 1.0);
    //gl_FragColor = vec4(geoNormal.xz*0.5 + 0.5, geoNormal.y, 1.0);
    //gl_FragColor = vec4(normalize(vec3(normalTexel.x, 0.0, normalTexel.z)), 1.0);
    //gl_FragColor = vec4(normalize(textureValue), 1.0);

    //gl_FragColor = vec4(diffuseColor*5.0, 1.0);
    //gl_FragColor = vec4(diffuseColor +  specularColor, 1.0);
    //gl_FragColor = vec4(specIncidence, specIncidence, specIncidence, 1.0);
    //gl_FragColor = vec4(specularColor, 1.0);
    
    //gl_FragColor = vec4(normalize(reflection), 1.0);
    //gl_FragColor = vec4(normalize(v_WorldPosition), 1.0);
    //gl_FragColor = vec4((cameraPosition), 1.0);
    //gl_FragColor = vec4((normalTexel), 1.0);
    //gl_FragColor = vec4(vec3(v_distToCam / 255.0), 1.0);
  }
  `;