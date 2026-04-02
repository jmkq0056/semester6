#!/usr/bin/env python3
"""
Intuition Image Generator - Fast SD Turbo for educational visualizations
Optimized for Apple Silicon with MPS acceleration

Usage:
    python intuition_image.py "A phone book being opened to middle page" --aspect wide

Dependencies:
    pip install torch diffusers transformers accelerate
"""

import sys
import json
import uuid
import os
from pathlib import Path

# Suppress warnings for cleaner output
os.environ["TOKENIZERS_PARALLELISM"] = "false"
import warnings
warnings.filterwarnings("ignore")

# Pre-prompt for consistent educational style
STYLE_PREPROMPT = """Digital illustration, isometric 3D style, clean white background, \
bright saturated colors, simple geometric shapes, professional infographic, \
single focused subject centered in frame, studio lighting, no text, \
concept art for educational textbook, vector art style. """


def generate_image(prompt: str, aspect: str = "square", output_dir: str = None):
    """Generate an intuition image using SD Turbo with MPS acceleration."""
    try:
        import torch
        from diffusers import AutoPipelineForText2Image

        # Aspect ratio dimensions (optimized for SD Turbo 512x512 base)
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

        # Detect device - MPS uses float32 (most reliable), CUDA uses float16
        if torch.backends.mps.is_available():
            device = "mps"
            dtype = torch.float32  # MPS needs float32 to avoid black images
        elif torch.cuda.is_available():
            device = "cuda"
            dtype = torch.float16
        else:
            device = "cpu"
            dtype = torch.float32

        # Use SD Turbo (smaller/faster than SDXL Turbo, ~2GB vs ~6GB)
        pipe = AutoPipelineForText2Image.from_pretrained(
            "stabilityai/sd-turbo",
            torch_dtype=dtype,
            safety_checker=None,  # Disable for speed
            requires_safety_checker=False
        )
        pipe = pipe.to(device)

        # Memory optimizations
        pipe.enable_attention_slicing()
        if hasattr(pipe, 'enable_vae_slicing'):
            pipe.enable_vae_slicing()

        # Build full prompt with style prefix
        full_prompt = STYLE_PREPROMPT + prompt

        # Generate image (SD Turbo: 1-4 steps, no guidance)
        generator = torch.Generator(device=device).manual_seed(42)

        image = pipe(
            prompt=full_prompt,
            num_inference_steps=2,  # Turbo only needs 1-2 steps
            guidance_scale=0.0,     # No classifier-free guidance
            width=width,
            height=height,
            generator=generator
        ).images[0]

        # Save image with unique filename
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
            "device": device
        }

    except ImportError as e:
        missing_pkg = str(e).split("'")[-2] if "'" in str(e) else str(e)
        return {
            "success": False,
            "error": f"Missing package: {missing_pkg}. Run: pip install torch diffusers transformers accelerate"
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

    # Validate aspect ratio
    if aspect not in ["square", "wide", "tall"]:
        aspect = "square"

    result = generate_image(prompt, aspect)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
