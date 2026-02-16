"""
Sybil Image Generation Service
FastAPI server using SDXL Turbo for generating profile pictures and banners.
Runs on port 8100, lazy-loads model on first request.
"""

import os
import time
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

# Uptime + generation counters
SERVER_START_TIME = time.time()
total_generated = 0
avatars_generated = 0
banners_generated = 0


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


class UpdateStylesRequest(BaseModel):
    avatar_styles: list[str] | None = None
    banner_styles: list[str] | None = None


# --- Avatar styles ---

AVATAR_STYLES = [
    "portrait photo of a young person, natural lighting, casual, looking at camera, shallow depth of field",
    "professional headshot, studio lighting, neutral background, confident expression, sharp focus",
    "candid selfie of a person outdoors, golden hour, warm tones, natural smile",
    "portrait of a person in a coffee shop, soft ambient lighting, bokeh background",
    "close-up portrait, dramatic side lighting, moody atmosphere, sharp details",
    "casual portrait photo, urban street background, natural daylight, relaxed pose",
    "portrait of a person at sunset, warm orange light, silhouette edges, peaceful expression",
    "indoor portrait, window light, soft shadows, clean modern room background",
    "portrait photo of a person, overcast day, muted tones, thoughtful expression, natural skin",
    "headshot portrait, ring light, clean background, friendly expression, high detail",
]

BANNER_STYLES = [
    "aerial photograph of a city skyline at golden hour, warm light, wide panoramic",
    "landscape photograph of mountains and lake, moody clouds, cinematic wide shot",
    "urban street photography, rain reflections, neon signs, night, wide format",
    "ocean waves crashing on rocky coast, dramatic sky, panoramic photograph",
    "dense forest canopy from above, misty morning, green tones, wide shot",
    "desert highway stretching to horizon, sunset, golden light, panoramic",
    "rooftop view of city at night, bokeh lights, wide angle photograph",
    "autumn forest path, golden leaves, soft light filtering through trees, wide",
    "beach at sunrise, calm water, pastel sky, minimal and serene, panoramic",
    "snow-covered mountain range, blue hour, crisp detail, cinematic wide shot",
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
        prompt = f"{style}, photorealistic, 8k, detailed skin texture, DSLR photograph"
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

        global total_generated, avatars_generated
        total_generated += 1
        avatars_generated += 1

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
        prompt = f"{style}, photorealistic, 8k, DSLR photograph, sharp detail"
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

        global total_generated, banners_generated
        total_generated += 1
        banners_generated += 1

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


@app.get("/styles")
async def get_styles():
    """Return current avatar and banner style prompts."""
    return {"avatar_styles": AVATAR_STYLES, "banner_styles": BANNER_STYLES}


@app.put("/styles")
async def update_styles(req: UpdateStylesRequest):
    """Update avatar and/or banner style prompts."""
    global AVATAR_STYLES, BANNER_STYLES
    if req.avatar_styles is not None:
        if len(req.avatar_styles) == 0:
            raise HTTPException(status_code=400, detail="avatar_styles cannot be empty")
        AVATAR_STYLES = req.avatar_styles
    if req.banner_styles is not None:
        if len(req.banner_styles) == 0:
            raise HTTPException(status_code=400, detail="banner_styles cannot be empty")
        BANNER_STYLES = req.banner_styles
    return {"success": True, "avatar_styles": len(AVATAR_STYLES), "banner_styles": len(BANNER_STYLES)}


@app.get("/stats")
async def get_stats():
    """Return generation statistics and server info."""
    # Calculate output directory size
    dir_size = sum(f.stat().st_size for f in OUTPUT_DIR.glob("*.png")) / (1024 * 1024)
    return {
        "total_generated": total_generated,
        "avatars_generated": avatars_generated,
        "banners_generated": banners_generated,
        "output_dir_size_mb": round(dir_size, 2),
        "model_loaded": model_loaded,
        "device": get_device(),
        "uptime_seconds": round(time.time() - SERVER_START_TIME),
    }


@app.get("/recent")
async def get_recent(limit: int = 20):
    """Return recent generated files, newest first."""
    files = sorted(OUTPUT_DIR.glob("*.png"), key=lambda f: f.stat().st_mtime, reverse=True)[:limit]
    result = []
    for f in files:
        stat = f.stat()
        file_type = "avatar" if f.name.startswith("avatar_") else "banner" if f.name.startswith("banner_") else "unknown"
        result.append({
            "filename": f.name,
            "type": file_type,
            "size_kb": round(stat.st_size / 1024, 1),
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stat.st_mtime)),
        })
    return {"files": result}


@app.post("/clear-output")
async def clear_output():
    """Delete all PNG files from the output directory."""
    files = list(OUTPUT_DIR.glob("*.png"))
    for f in files:
        f.unlink()
    return {"success": True, "deleted": len(files)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8100)
