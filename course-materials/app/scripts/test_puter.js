// Test Puter.js image generation
// Run with: node test_puter.js

const { puter } = require('@heyputer/puter.js');
const fs = require('fs');
const path = require('path');

async function testPuterImage() {
    console.log("Testing Puter.js GPT Image generation...\n");

    const prompt = "A vertical stack of 5 colorful blocks, top block floating upward, LIFO stack concept";

    console.log("Prompt:", prompt);
    console.log("Generating image...\n");

    try {
        // Try with returnRawResponse to see what we get
        const result = await puter.ai.txt2img(prompt, {
            model: "dall-e-3",  // Try DALL-E 3 instead
            quality: "standard"
        });

        console.log("Result type:", typeof result);
        console.log("Result keys:", result ? Object.keys(result) : 'null');
        console.log("Result:", JSON.stringify(result, null, 2).slice(0, 500));

        // Save image if we got data
        const outputDir = path.join(__dirname, '..', 'data', '.intuition-images');
        fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, 'test-puter.png');

        if (result?.src) {
            const base64 = result.src.replace(/^data:image\/\w+;base64,/, '');
            fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));
            console.log("\n✓ Image saved to:", outputPath);
        } else if (result?.data) {
            fs.writeFileSync(outputPath, Buffer.from(result.data, 'base64'));
            console.log("\n✓ Image saved to:", outputPath);
        } else if (Buffer.isBuffer(result)) {
            fs.writeFileSync(outputPath, result);
            console.log("\n✓ Image saved to:", outputPath);
        }

    } catch (err) {
        console.log("Error:", err.message || err);
        console.log("Code:", err.code);

        // Try stable diffusion as fallback
        console.log("\nTrying stable-diffusion-3...");
        try {
            const result2 = await puter.ai.txt2img(prompt, {
                model: "stable-diffusion-3"
            });
            console.log("SD3 Result:", result2);
        } catch (e2) {
            console.log("SD3 Error:", e2.message || e2);
        }
    }
}

testPuterImage();
