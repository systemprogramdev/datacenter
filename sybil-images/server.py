"""
Sybil Image Generation Service
FastAPI server using SDXL Turbo for generating profile pictures and banners.
Runs on port 8100, lazy-loads model on first request.
"""

import os
import uuid
import random
from pathlib import Path
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Output directory for generated images
OUTPUT_DIR = Path(__file__).parent / "output"
OUTPUT_DIR.mkdir(exist_ok=True)

# Global model reference (lazy loaded)
pipe = None
model_loaded = False


def get_device():
    """Get the best available device."""
    if torch.backends.mps.is_available():
        return "mps"
    elif torch.cuda.is_available():
        return "cuda"
    return "cpu"


def load_model():
    """Lazy-load SDXL Turbo pipeline."""
    global pipe, model_loaded
    if model_loaded:
        return

    from diffusers import AutoPipelineForText2Image

    device = get_device()
    print(f"[SybilImages] Loading SDXL Turbo on {device}...")

    pipe = AutoPipelineForText2Image.from_pretrained(
        "stabilityai/sdxl-turbo",
        torch_dtype=torch.float16 if device != "cpu" else torch.float32,
        variant="fp16" if device != "cpu" else None,
    )
    pipe = pipe.to(device)

    # Disable safety checker for speed (these are abstract/non-human images)
    pipe.safety_checker = None

    model_loaded = True
    print("[SybilImages] Model loaded successfully.")


def unload_model():
    """Free GPU/MPS memory by unloading the model."""
    global pipe, model_loaded
    if pipe is not None:
        del pipe
        pipe = None
    model_loaded = False

    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    elif torch.cuda.is_available():
        torch.cuda.empty_cache()

    import gc
    gc.collect()
    print("[SybilImages] Model unloaded, memory freed.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[SybilImages] Service starting on port 8100...")
    yield
    unload_model()


app = FastAPI(title="Sybil Image Service", lifespan=lifespan)


# --- Request models ---

class GenerateRequest(BaseModel):
    name: str = ""
    style: str = ""


# --- Avatar styles ---

AVATAR_STYLES = [
    "abstract geometric portrait, vibrant colors, digital art",
    "anime-style character avatar, colorful, expressive",
    "pixel art character portrait, retro gaming style",
    "cyberpunk character portrait, neon glow, dark background",
    "watercolor portrait, soft colors, artistic",
    "low-poly 3d character portrait, colorful geometric",
    "graffiti style portrait, urban art, spray paint",
    "minimalist line art portrait, clean, modern",
    "vaporwave aesthetic portrait, pink and blue, retro",
    "glitch art portrait, digital distortion, colorful",
]

BANNER_STYLES = [
    "abstract gradient waves, vibrant colors, wide format",
    "cyberpunk cityscape panorama, neon lights, dark",
    "geometric pattern, colorful triangles, modern design",
    "space nebula panorama, stars, cosmic colors",
    "glitch art wide banner, digital distortion, vaporwave",
    "abstract fluid art, marble effect, colorful",
    "retro synthwave landscape, sunset, grid, neon",
    "minimalist abstract shapes, pastel colors, clean",
    "graffiti wall panorama, urban, colorful spray paint",
    "digital circuit board pattern, tech, glowing lines",
]


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": model_loaded, "device": get_device()}


@app.post("/generate-avatar")
async def generate_avatar(req: GenerateRequest):
    """Generate a 512x512 profile picture."""
    try:
        load_model()

        style = req.style or random.choice(AVATAR_STYLES)
        prompt = f"{style}, profile picture, high quality"
        if req.name:
            # Don't put the name literally in the prompt, use it as seed variation
            seed = hash(req.name) % (2**32)
        else:
            seed = random.randint(0, 2**32 - 1)

        generator = torch.Generator(device="cpu").manual_seed(seed)

        image = pipe(
            prompt=prompt,
            num_inference_steps=4,
            guidance_scale=0.0,
            width=512,
            height=512,
            generator=generator,
        ).images[0]

        filename = f"avatar_{uuid.uuid4().hex[:12]}.png"
        filepath = OUTPUT_DIR / filename
        image.save(filepath)

        return JSONResponse({
            "success": True,
            "path": str(filepath),
            "file_path": str(filepath),
            "filename": filename,
            "size": "512x512",
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate-banner")
async def generate_banner(req: GenerateRequest):
    """Generate a 1024x256 banner image."""
    try:
        load_model()

        style = req.style or random.choice(BANNER_STYLES)
        prompt = f"{style}, wide banner, panoramic"
        if req.name:
            seed = hash(req.name + "_banner") % (2**32)
        else:
            seed = random.randint(0, 2**32 - 1)

        generator = torch.Generator(device="cpu").manual_seed(seed)

        image = pipe(
            prompt=prompt,
            num_inference_steps=4,
            guidance_scale=0.0,
            width=1024,
            height=256,
            generator=generator,
        ).images[0]

        filename = f"banner_{uuid.uuid4().hex[:12]}.png"
        filepath = OUTPUT_DIR / filename
        image.save(filepath)

        return JSONResponse({
            "success": True,
            "path": str(filepath),
            "file_path": str(filepath),
            "filename": filename,
            "size": "1024x256",
        })
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/unload")
async def unload():
    """Free GPU memory after batch processing."""
    unload_model()
    return {"success": True, "message": "Model unloaded"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8100)
