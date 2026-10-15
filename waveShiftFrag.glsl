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

void mainImage()
{

    // Get Texture
    vec3 sRGB = texture2D(uTexture, vUv).rgb;
    
    // This is pathetic I should just be able to save this
    mat3 lambdaWeights = mat3(
        xFit_1931(lambdaRed),xFit_1931(lambdaGreen),xFit_1931(lambdaBlue),
        yFit_1931(lambdaRed),yFit_1931(lambdaGreen),yFit_1931(lambdaBlue),
        zFit_1931(lambdaRed),zFit_1931(lambdaGreen),zFit_1931(lambdaBlue)
    );
    
    vec3 SPDXYZ = inverse(lambdaWeights) * sRGB;
    
    mat3 shiftedLambdaWeights = mat3(
        xFit_1931(lambdaRed+uDeltaLambda),xFit_1931(lambdaGreen+uDeltaLambda),xFit_1931(lambdaBlue+uDeltaLambda),
        yFit_1931(lambdaRed+uDeltaLambda),yFit_1931(lambdaGreen+uDeltaLambda),yFit_1931(lambdaBlue+uDeltaLambda),
        zFit_1931(lambdaRed+uDeltaLambda),zFit_1931(lambdaGreen+uDeltaLambda),zFit_1931(lambdaBlue+uDeltaLambda)
    );
    
    vec3 shiftedsRGB = shiftedLambdaWeights * SPDXYZ;

    // Output to screen
    gl_FragColor = vec4(shiftedsRGB,1.0);
}