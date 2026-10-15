// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 8000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
//renderer.setClearColor(0xf0f0f0);
renderer.setClearColor(0x090909);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Camera position
camera.position.z = 50;

// Orbit controls
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.25;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

//const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
//directionalLight.position.set(1, 1, 1);
//scene.add(directionalLight);

// Create waveshift shader material
const waveShiftPhongVertShader = `
        uniform mat4 uPrevModelViewMatrix;
        uniform mat4 uPrevViewProjectionMatrix;

        out vec4 vCurrentPos;
        out vec4 vPreviousPos;

        out vec2 vUv;
        out vec3 vNormal;
        out vec3 vViewPosition;
        
        void main() {
            vCurrentPos = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            vPreviousPos = uPrevModelViewMatrix * vec4(position, 1.0);
            
            vUv = uv;
            vNormal = normalize(normalMatrix * normal);
            vViewPosition = -vCurrentPos.xyz;
        }
    `;

const waveShiftPhongFragShader = `
        uniform vec3 uCameraPosition;

        uniform vec3 diffuse;
        uniform vec3 emissive;
        uniform vec3 specular;
        uniform float shininess;
        uniform float opacity;

        uniform sampler2D map;
        uniform sampler2D specularMap;

        in vec4 vCurrentPos;
        in vec4 vPreviousPos;

        in vec3 vNormal;
        in vec3 vViewPosition;
        in vec2 vUv;

        // Lights (directional, point, spot)
        #if NUM_DIR_LIGHTS > 0
            struct DirectionalLight {
                vec3 direction;
                vec3 color;
            };
            uniform DirectionalLight directionalLights[NUM_DIR_LIGHTS];
        #endif

        #if NUM_POINT_LIGHTS > 0
            struct PointLight {
                vec3 position;
                vec3 color;
                float distance;
                float decay;
            };
            uniform PointLight pointLights[NUM_POINT_LIGHTS];
        #endif

        layout(location = 0) out vec4 fragColor;     // Main color
        //layout(location = 1) out vec4 fragMotionVectors;  // motion vectors!! (relative to what?? camera right??)

        // Input: Wavelength in nanometers
        // L CMF
        float xFit_1931( float wave )
        {
            float t1 = (wave-442.0f)*((wave<442.0f)?0.0624f:0.0374f);
            float t2 = (wave-599.8f)*((wave<599.8f)?0.0264f:0.0323f);
            float t3 = (wave-501.1f)*((wave<501.1f)?0.0490f:0.0382f);
            return 0.362f*exp(-0.5f*t1*t1) + 1.056f*exp(-0.5f*t2*t2) - 0.065f*exp(-0.5f*t3*t3);
        }

        // M CMF
        float yFit_1931( float wave )
        {
            float t1 = (wave-568.8f)*((wave<568.8f)?0.0213f:0.0247f);
            float t2 = (wave-530.9f)*((wave<530.9f)?0.0613f:0.0322f);
            return 0.821f*exp(-0.5f*t1*t1) + 0.286f*exp(-0.5f*t2*t2);
        }

        // S CMF
        float zFit_1931( float wave )
        {
            float t1 = (wave-437.0f)*((wave<437.0f)?0.0845f:0.0278f);
            float t2 = (wave-459.0f)*((wave<459.0f)?0.0385f:0.0725f);
            return 1.217f*exp(-0.5f*t1*t1) + 0.681f*exp(-0.5f*t2*t2);
        }

        // Take a look at https://www.desmos.com/calculator/f6dvpx3afr
        const float lambdaRed = 599.8f;
        const float lambdaGreen = 554.1f;
        const float lambdaBlue = 448.2f;

        void main()
        {
            float deltaLambda = 0.0;

            // velocity math time!!
            vec3 vel = vCurrentPos.xyz - vPreviousPos.xyz;
            float intensity = 100.0; // magic number
            deltaLambda = intensity*dot(vel,uCameraPosition);

            // Perform all the nessecary Phong lighting math here
            vec4 phongFragColor = vec4(0.0,0.0,0.0,0.0);
            {
                vec4 diffuseColor = vec4(diffuse, opacity);
                vec3 specularColor = specular;
                
                // Apply texture if available
                //diffuseColor *= texture2D(map, vUv);
                
                // Apply specular map if available
                specularColor *= texture2D(specularMap, vUv).rgb;
                
                vec3 normal = normalize(vNormal);
                vec3 viewDir = normalize(vViewPosition);
                vec3 totalLighting = emissive;

                // Phong lighting calculation
                #if NUM_DIR_LIGHTS > 0
                    for (int i = 0; i < NUM_DIR_LIGHTS; i++) {
                        vec3 lightDir = normalize(directionalLights[i].direction);
                        vec3 reflectDir = reflect(-lightDir, normal);
                        
                        // Diffuse component (Lambert)
                        float diff = max(dot(normal, lightDir), 0.0);
                        vec3 diffuseLight = directionalLights[i].color * diff;
                        
                        // Specular component (Phong)
                        float spec = pow(max(dot(viewDir, reflectDir), 0.0), shininess);
                        vec3 specularLight = directionalLights[i].color * spec * specularColor;
                        
                        totalLighting += diffuseLight * diffuseColor.rgb + specularLight;
                    }
                #endif

                #if NUM_POINT_LIGHTS > 0
                    for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
                        vec3 lightVector = pointLights[i].position - vViewPosition;
                        float lightDistance = length(lightVector);
                        vec3 lightDir = normalize(lightVector);
                        
                        // Attenuation
                        float attenuation = 1.0 / (1.0 + pointLights[i].decay * lightDistance * lightDistance);
                        
                        // Diffuse
                        float diff = max(dot(normal, lightDir), 0.0);
                        vec3 diffuseLight = pointLights[i].color * diff * attenuation;
                        
                        // Specular
                        vec3 reflectDir = reflect(-lightDir, normal);
                        float spec = pow(max(dot(viewDir, reflectDir), 0.0), shininess);
                        vec3 specularLight = pointLights[i].color * spec * specularColor * attenuation;
                        
                        totalLighting += diffuseLight * diffuseColor.rgb + specularLight;
                    }
                #endif

                phongFragColor = vec4(totalLighting, diffuseColor.a);
            }
            
            // This is pathetic I should just be able to save this as a constant value
            mat3 lambdaWeights = mat3(
                xFit_1931(lambdaRed),xFit_1931(lambdaGreen),xFit_1931(lambdaBlue),
                yFit_1931(lambdaRed),yFit_1931(lambdaGreen),yFit_1931(lambdaBlue),
                zFit_1931(lambdaRed),zFit_1931(lambdaGreen),zFit_1931(lambdaBlue)
            );
            
            vec3 SPDXYZ = inverse(lambdaWeights) * phongFragColor.xyz;
            
            mat3 shiftedLambdaWeights = mat3(
                xFit_1931(lambdaRed-deltaLambda),xFit_1931(lambdaGreen-deltaLambda),xFit_1931(lambdaBlue-deltaLambda),
                yFit_1931(lambdaRed-deltaLambda),yFit_1931(lambdaGreen-deltaLambda),yFit_1931(lambdaBlue-deltaLambda),
                zFit_1931(lambdaRed-deltaLambda),zFit_1931(lambdaGreen-deltaLambda),zFit_1931(lambdaBlue-deltaLambda)
            );
            
            // Final color
            vec3 shiftedsRGB = shiftedLambdaWeights * SPDXYZ;

            // Outputs
            //fragColor = vec4(shiftedsRGB,1.0);
            fragColor = vec4(phongFragColor.xyz,1.0);
        }
    `;

// ugly and I hate it
function WaveShiftShaderMaterial(params = {}) {
    let newShader = new THREE.ShaderMaterial(
        {
            uniforms: THREE.UniformsUtils.merge(
                [
                    //https://github.com/mrdoob/three.js/blob/master/src/renderers/shaders/UniformsLib.js
                    THREE.UniformsLib.common,       // Includes diffuse and map
                    THREE.UniformsLib.specularmap,  // Includes specular map
                    THREE.UniformsLib.envmap,       // includes envmap
                    {
                        // includes everything that a phong shader would allow
                        emissive: {value: new THREE.Color(0x000000)},
                        specular: {value: new THREE.Color(0x000000)},
                        shininess: {value: 0.0}
                    },
                    THREE.UniformsLib.lights,       // Includes light uniforms
                    {
                        
                        uCameraPosition: {value: new THREE.Vector3(0,0,0)},
                        
                        // For Motion Vectors
                        uPrevModelViewMatrix: { value: new THREE.Matrix4() },
                        uPrevViewProjectionMatrix: { value: new THREE.Matrix4() }
                    }
                ]
            ),

            vertexShader: waveShiftPhongVertShader,
            fragmentShader: waveShiftPhongFragShader,
            glslVersion: THREE.GLSL3,
            lights: true,                   // Enable lighting
            defines: {
                "USE_SPECULAR": ""          // Enable specular highlights
            }
        }
    );

    newShader.uniforms.diffuse.value.set(params.diffuse);
    newShader.uniforms.emissive.value.set(params.emissive);
    newShader.uniforms.specular.value.set(params.specular);
    newShader.uniforms.shininess.value = (params.shininess);

    //newShader.uniforms.map.value.set(params.map);
    //newShader.uniforms.specularMap.value.set(params.specularMap);

    return newShader;
}

// TODO: REPLACE IMAGE PLANE WITH A SOLAR SYSTEM
// https://discoverthreejs.com/book/first-steps/built-in-geometries/
// https://threejs.org/docs/index.html?q=geometry

// All of these numbers are completely arbitrary for the point of presentation
const sunGeometry = new THREE.SphereGeometry(30, 32, 16);
const sunLightEmission = new THREE.PointLight( 0xff0000, 1000, 1000);
let sunOBJ = new THREE.Mesh(sunGeometry,WaveShiftShaderMaterial(
    {
        diffuse: 0x000000,       
        specular: 0xffffff,    
        shininess: 100,       
        emissive: 0xe3f49c
    }
));

const sunMassKG = 1000;

// FIRST PLANET
const planet1Geometry = new THREE.SphereGeometry(1, 16, 8);
//let planet1OBJ = new THREE.Mesh(planet1Geometry,waveShiftShaderMaterial);
let planet1OBJ = new THREE.Mesh(planet1Geometry,new THREE.MeshBasicMaterial( { color: 0xffff00 } ));
const planet1MassKG = 10;
const planet1SemiMajorAxis = 60;
const planet1Eccentricity = 0.2;

// SECOND PLANET
const planet2Geometry = new THREE.SphereGeometry(2, 16, 8);
let planet2OBJ = new THREE.Mesh(planet2Geometry,WaveShiftShaderMaterial(
    {
        diffuse: 0x4e847a,       
        specular: 0xffffff,    
        shininess: 100,       
        emissive: 0x000000
    }
));
const planet2MassKG = 10;

const planet2SemiMajorAxis = 90;
const planet2Eccentricity = 0.1;

const planet2MoonGeometry = new THREE.SphereGeometry(0.3, 16, 8);
let planet2MoonOBJ = new THREE.Mesh(planet2MoonGeometry,WaveShiftShaderMaterial(
    {
        diffuse: 0x4e847a,       
        specular: 0xffffff,    
        shininess: 100,       
        emissive: 0x000000
    }
));
const planet2MoonMassKG = 1;

// THIRD PLANET
const planet3Geometry = new THREE.SphereGeometry(1.5, 16, 8);
let planet3OBJ = new THREE.Mesh(planet3Geometry,WaveShiftShaderMaterial(
    {
        diffuse: 0x4e847a,       
        specular: 0xffffff,    
        shininess: 100,       
        emissive: 0x000000
    }
));
const planet3MassKG = 17;

const planet3SemiMajorAxis = 120;
const planet3Eccentricity = 0.4;

// FIRST GAS GIANT
const gasGiant1Geometry = new THREE.SphereGeometry(4, 32, 16);
let gasGiant1OBJ = new THREE.Mesh(gasGiant1Geometry,WaveShiftShaderMaterial(
    {
        diffuse: 0x4e847a,       
        specular: 0xffffff,    
        shininess: 100,       
        emissive: 0x000000
    }
));
const gasGiant1MassKG = 50;

const gasGiant1SemiMajorAxis = 160;
const gasGiant1Eccentricity = 0.3;

// SECOND GAS GIANT
const gasGiant2Geometry = new THREE.SphereGeometry(7, 32, 16);
let gasGiant2OBJ = new THREE.Mesh(gasGiant2Geometry,WaveShiftShaderMaterial(
    {
        diffuse: 0x4e847a,       
        specular: 0xffffff,    
        shininess: 100,       
        emissive: 0x000000
    }
));
const gasGiant2MassKG = 70;

const gasGiant2SemiMajorAxis = 200;
const gasGiant2Eccentricity = 0.4;

const gasGiant2Moon1Geometry = new THREE.SphereGeometry(0.4, 16, 8);
let gasGiant2Moon1OBJ = new THREE.Mesh(gasGiant2Moon1Geometry,WaveShiftShaderMaterial(
    {
        diffuse: 0x4e847a,       
        specular: 0xffffff,    
        shininess: 100,       
        emissive: 0x000000
    }
));
const gasGiant2Moon1MassKG = 1;

const gasGiant2Moon2Geometry = new THREE.SphereGeometry(0.2, 16, 8);
let gasGiant2Moon2OBJ = new THREE.Mesh(gasGiant2Moon2Geometry,WaveShiftShaderMaterial(
    {
        diffuse: 0x4e847a,       
        specular: 0xffffff,    
        shininess: 100,       
        emissive: 0x000000
    }
));
const gasGiant2Moon2MassKG = 2;

// COMET
const cometGeometry = new THREE.SphereGeometry(1, 32, 16);
let cometOBJ = new THREE.Mesh(cometGeometry,WaveShiftShaderMaterial(
    {
        diffuse: 0x4e847a,       
        specular: 0xffffff,    
        shininess: 100,       
        emissive: 0x000000
    }
));
const cometMassKG = 0.3;

const cometSemiMajorAxis = 240;
const cometEccentricity = 0.8;

// add objects to scene
scene.add(sunOBJ);
scene.add(sunLightEmission);

scene.add(planet1OBJ);

scene.add(planet2OBJ);
scene.add(planet2MoonOBJ);

scene.add(planet3OBJ);

scene.add(gasGiant1OBJ);

scene.add(gasGiant2OBJ);
scene.add(gasGiant2Moon1OBJ);
scene.add(gasGiant2Moon2OBJ);

scene.add(cometOBJ);

// Create the image plane
//const geometry = new THREE.PlaneGeometry(5, 5);
//let imagePlane = new THREE.Mesh(geometry, waveShiftShaderMaterial);
//scene.add(imagePlane);

// Place our objects into the scene!!

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Image upload handler
document.getElementById('image-upload').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(event) {
        const image = new Image();
        image.onload = function() {
            // Create texture from image
            const texture = new THREE.Texture(image);
            texture.needsUpdate = true;
            waveShiftShaderMaterial.uniforms.uTexture.value = texture;

            // Adjust the plane's aspect ratio to match the image
            const aspect = image.width / image.height;
            imagePlane.scale.x = aspect;

        };
        image.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

/**
 * Calculates orbital position with mass considerations
 * @param {number} semiMajorAxis - in meters
 * @param {number} eccentricity - unitless (0-1)
 * @param {number} time - seconds since perihelion
 * @param {number} centralMass - mass of primary body (kg)
 * @param {number} bodyMass - mass of orbiting body (kg)
 * @param {Object} [options] - optional parameters
 * @returns {THREE.Vector3} position in meters
 */
function getOrbitalPositionWithMass(
    semiMajorAxis,
    eccentricity,
    time,
    centralMass,
    bodyMass,
    options = {}
) {
    // Constants
    const G = 6.67430e-11; // gravitational constant in m³ kg⁻¹ s⁻²
    
    // Calculate standard gravitational parameter
    const mu = G * (centralMass + bodyMass);
    
    // Calculate orbital period (Kepler's Third Law)
    const period = 2 * Math.PI * Math.sqrt(Math.pow(semiMajorAxis, 3) / mu);
    
    // Normalize time to [0,1] range of the orbital period
    const normalizedTime = ((time % period) / period) * 2 * Math.PI;
    
    // Solve Kepler's equation as before but with correct mean motion
    const meanAnomaly = normalizedTime;
    let eccentricAnomaly = meanAnomaly;
    
    for (let i = 0; i < 10; i++) {
        const delta = eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - meanAnomaly;
        const deltaPrime = 1 - eccentricity * Math.cos(eccentricAnomaly);
        eccentricAnomaly -= delta / deltaPrime;
    }
    
    // Calculate true anomaly and distance
    const trueAnomaly = 2 * Math.atan2(
        Math.sqrt(1 + eccentricity) * Math.sin(eccentricAnomaly / 2),
        Math.sqrt(1 - eccentricity) * Math.cos(eccentricAnomaly / 2)
    );
    
    const distance = semiMajorAxis * (1 - eccentricity * Math.cos(eccentricAnomaly));
    
    // Calculate position relative to barycenter
    const barycenterDistance = (semiMajorAxis * bodyMass) / (centralMass + bodyMass);
    const x = distance * Math.cos(trueAnomaly) - barycenterDistance;
    const y = distance * Math.sin(trueAnomaly);
    
    // Apply any additional orbital orientation parameters
    const position = new THREE.Vector3(x, 0, y);
    
    if (options.inclination) {
        position.applyAxisAngle(new THREE.Vector3(1, 0, 0), options.inclination);
    }
    if (options.longitudeAscendingNode) {
        position.applyAxisAngle(new THREE.Vector3(0, 0, 1), options.longitudeAscendingNode);
    }
    if (options.argumentOfPeriapsis) {
        position.applyAxisAngle(new THREE.Vector3(0, 0, 1), options.argumentOfPeriapsis);
    }
    
    return position;
}

// Animation loop
let deltaTime = 0.0;
function animate() {
    requestAnimationFrame(animate);

    controls.update();
    
    // UPDATE POSITION OF THE PLANETS
    {
        planet1OBJ.position.copy(
            getOrbitalPositionWithMass(
                planet1SemiMajorAxis,
                planet1Eccentricity,
                deltaTime,
                sunMassKG,
                planet1MassKG
            )
        );

        planet2OBJ.position.copy(
            getOrbitalPositionWithMass(
                planet2SemiMajorAxis,
                planet2Eccentricity,
                deltaTime,
                sunMassKG,
                planet2MassKG
            )
        );

        planet3OBJ.position.copy(
            getOrbitalPositionWithMass(
                planet3SemiMajorAxis,
                planet3Eccentricity,
                deltaTime,
                sunMassKG,
                planet3MassKG
            )
        );

        gasGiant1OBJ.position.copy(
            getOrbitalPositionWithMass(
                gasGiant1SemiMajorAxis,
                gasGiant1Eccentricity,
                deltaTime,
                sunMassKG,
                gasGiant1MassKG
            )
        );

        gasGiant2OBJ.position.copy(
            getOrbitalPositionWithMass(
                gasGiant2SemiMajorAxis,
                gasGiant2Eccentricity,
                deltaTime,
                sunMassKG,
                gasGiant2MassKG
            )
        );

        cometOBJ.position.copy(
            getOrbitalPositionWithMass(
                cometSemiMajorAxis,
                cometEccentricity,
                deltaTime,
                sunMassKG,
                cometMassKG
            )
        );
    
    }
    

    // UPDATE UNIFORMS
    //waveShiftShaderMaterial.uniforms.uTime.value += 0.01;
    //waveShiftShaderMaterial.uniforms.uCameraPosition.value.copy(camera.position);
    //let prevVM = imagePlane.modelViewMatrix.clone();
    //let prevPM = camera.projectionMatrix.clone();
    //waveShiftShaderMaterial.uniforms.uPrevModelViewMatrix.value = prevVM;
    //waveShiftShaderMaterial.uniforms.uPrevViewProjectionMatrix.value = prevPM;

    // update the matrices for all objects in the scene


    // RENDER SCENE
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);

    // update deltaTime
    // This is in seconds
    // Let's say our simulation passes by in days per frame
    deltaTime += 86400.0;
}
animate();