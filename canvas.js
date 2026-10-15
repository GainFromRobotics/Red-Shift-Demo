// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
//renderer.setClearColor(0xf0f0f0);
renderer.setClearColor(0x090909);
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Camera position
camera.position.z = 5;

// Orbit controls
const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.25;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);

// Create render target with multiple buffers
//const renderTarget = new THREE.WebGLMultipleRenderTargets(window.innerWidth , window.innerHeight, 2);
//renderTarget.texture[0].name = "abledoBuffer";
//renderTarget.texture[0].format = THREE.RGBAFormat;
//renderTarget.texture[1].name = "velocityCameraSpaceBuffer";
//renderTarget.texture[1].format = THREE.RGBAFormat;

// Create waveshift shader material
const waveShiftShaderMaterial = new THREE.ShaderMaterial({
    uniforms: {
        // basic stuff
        uTexture: { value: null },

        // the change in wavelength
        uDeltaLambda: {value: 0.0},
        uTime: {value: 0.0},
    },

    // Sends uvs and position relative to camera
    vertexShader: `
        out vec2 vUv;
        
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

    // for security reasons this cannot be offset to its own file
    fragmentShader: `
        uniform sampler2D uTexture;
        uniform float uDeltaLambda;
        
        in vec2 vUv;

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
            deltaLambda = uDeltaLambda;

            // Get Texture
            vec3 sRGB = texture2D(uTexture, vUv).rgb;
            
            // This is pathetic I should just be able to save this as a constant value
            mat3 lambdaWeights = mat3(
                xFit_1931(lambdaRed),xFit_1931(lambdaGreen),xFit_1931(lambdaBlue),
                yFit_1931(lambdaRed),yFit_1931(lambdaGreen),yFit_1931(lambdaBlue),
                zFit_1931(lambdaRed),zFit_1931(lambdaGreen),zFit_1931(lambdaBlue)
            );
            
            vec3 SPDXYZ = inverse(lambdaWeights) * sRGB;
            
            mat3 shiftedLambdaWeights = mat3(
                xFit_1931(lambdaRed-deltaLambda),xFit_1931(lambdaGreen-deltaLambda),xFit_1931(lambdaBlue-deltaLambda),
                yFit_1931(lambdaRed-deltaLambda),yFit_1931(lambdaGreen-deltaLambda),yFit_1931(lambdaBlue-deltaLambda),
                zFit_1931(lambdaRed-deltaLambda),zFit_1931(lambdaGreen-deltaLambda),zFit_1931(lambdaBlue-deltaLambda)
            );
            
            // Final color
            vec3 shiftedsRGB = shiftedLambdaWeights * SPDXYZ;

            // Outputs
            fragColor = vec4(shiftedsRGB,1.0);
        }
    `,
    glslVersion: THREE.GLSL3,
});

// Create the image plane
const geometry = new THREE.PlaneGeometry(5, 5);
let imagePlane = new THREE.Mesh(geometry, waveShiftShaderMaterial);
scene.add(imagePlane);

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

// Shader control change handler
document.getElementById('shader-control').addEventListener('input', (e)=>{

    // change uniform value
    let deltaLambda = e.target.value;
    waveShiftShaderMaterial.uniforms.uDeltaLambda.value = deltaLambda;

    // display value
    document.getElementById("delta-lambda-display").innerHTML = `delta Lambda = ${deltaLambda}nm`;
});

// shader control reset handler
document.getElementById("shader-reset").onclick = function(){
    // change uniform value
    waveShiftShaderMaterial.uniforms.uDeltaLambda.value = 0;
    document.getElementById("shader-control").value = 0;
    document.getElementById("delta-lambda-display").innerHTML = "delta Lambda = 0nm";
};

// Animation loop
function animate() {
    requestAnimationFrame(animate);

    controls.update();

    // UPDATE UNIFORMS
    waveShiftShaderMaterial.uniforms.uTime.value += 0.01;

    // render the scene
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
}
animate();