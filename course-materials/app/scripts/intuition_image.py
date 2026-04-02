#!/usr/bin/env python3
"""
Intuition Image Generator v2 - Enhanced SD Turbo
Optimized for high-quality educational visualizations on Apple Silicon

Features:
- SD Turbo (4.8GB) - fast and efficient
- DPM++ scheduler with Karras sigmas
- Rich positive/negative prompts
- Memory optimizations for MPS
- Style-consistent educational outputs
"""

import sys
import json
import uuid
import os
import random
from pathlib import Path

# Suppress warnings
os.environ["TOKENIZERS_PARALLELISM"] = "false"
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"
import warnings
warnings.filterwarnings("ignore")

# Style prompts - emphasize NO TEXT/NUMBERS
STYLE_POSITIVE = (
    "minimalist vector illustration, white background, centered, "
    "simple flat design, bright colors, clean lines, objects only"
)

STYLE_NEGATIVE = (
    "text, words, letters, numbers, digits, writing, labels, captions, "
    "titles, subtitles, watermark, signature, alphabet, characters, "
    "blurry, noisy, photorealistic, cluttered"
)


def generate_image(prompt: str, aspect: str = "square", output_dir: str = None):
    """Generate a high-quality educational illustration using SDXL Turbo."""
    try:
        import torch
        from diffusers import AutoPipelineForText2Image

        # Aspect ratio dimensions (SD Turbo native is 512)
        ASPECTS = {
            "square": (512, 512),
            "wide": (640, 384),
            "tall": (384, 640)
        }
        width, height = ASPECTS.get(aspect, (512, 512))

        # Setup output directory
        if output_dir is None:
            output_dir = Path(__file__).parent.parent / "data" / ".intuition-images"
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        # Device and dtype configuration
        if torch.backends.mps.is_available():
            device = "mps"
            dtype = torch.float32  # MPS requires float32 for stable output
        elif torch.cuda.is_available():
            device = "cuda"
            dtype = torch.float16
        else:
            device = "cpu"
            dtype = torch.float32

        # Load SD Turbo with optimizations (smaller, faster)
        pipe = AutoPipelineForText2Image.from_pretrained(
            "stabilityai/sd-turbo",
            torch_dtype=dtype,
            use_safetensors=True,
            safety_checker=None,
            requires_safety_checker=False,
        )

        pipe = pipe.to(device)

        # Memory optimizations
        pipe.enable_attention_slicing("max")
        if hasattr(pipe, 'enable_vae_slicing'):
            pipe.enable_vae_slicing()
        if hasattr(pipe, 'enable_vae_tiling'):
            pipe.enable_vae_tiling()

        # Build prompt - subject first, then style
        enhanced_prompt = f"{prompt}, {STYLE_POSITIVE}"

        # Generate with optimized settings
        seed = random.randint(0, 2**32 - 1)
        generator = torch.Generator(device=device).manual_seed(seed)

        image = pipe(
            prompt=enhanced_prompt,
            negative_prompt=STYLE_NEGATIVE,
            num_inference_steps=4,       # SD Turbo: 1-4 steps
            guidance_scale=0.0,          # Turbo models need 0 guidance
            width=width,
            height=height,
            generator=generator,
        ).images[0]

        # Save with high quality
        filename = f"intuition-{uuid.uuid4().hex[:8]}.png"
        output_path = output_dir / filename
        image.save(output_path, "PNG", optimize=True)

        return {
            "success": True,
            "imagePath": f"/intuition-images/{filename}",
            "localPath": str(output_path),
            "prompt": prompt,
            "aspect": aspect,
            "dimensions": f"{width}x{height}",
            "device": device,
            "seed": seed
        }

    except ImportError as e:
        return {
            "success": False,
            "error": f"Missing package. Run: pip3 install torch diffusers transformers accelerate"
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


def main():
    """CLI entry point."""
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "Usage: python intuition_image.py 'prompt' [--aspect square|wide|tall]"
        }))
        sys.exit(1)

    prompt = sys.argv[1]
    aspect = "square"

    # Parse arguments
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == "--aspect" and i + 1 < len(sys.argv):
            aspect = sys.argv[i + 1]
            i += 2
        else:
            i += 1

    if aspect not in ["square", "wide", "tall"]:
        aspect = "square"

    result = generate_image(prompt, aspect)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
