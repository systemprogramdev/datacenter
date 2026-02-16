import { NextResponse } from "next/server";
import { ollama } from "@/lib/ollama";

interface GeneratedStyles {
  avatar_styles: string[];
  banner_styles: string[];
}

const PROMPT = `You are a prompt engineer for SDXL Turbo, a fast text-to-image model.

Generate 10 unique avatar (profile picture) prompts and 10 unique banner (wide header image) prompts.

Avatar prompts should describe portrait photographs of people — varied ages, lighting, settings, moods. Keep them photorealistic. No fantasy, no illustrations, no anime.

Banner prompts should describe wide landscape/cityscape/scenic photographs — varied locations, weather, time of day. Cinematic, panoramic feel. No people as the main subject.

Every prompt must be a single sentence, 15-30 words, focused on visual descriptors a diffusion model understands: lighting, composition, color palette, camera angle, atmosphere.

Do NOT repeat concepts. Each prompt must feel distinct.

Return JSON with this exact structure:
{
  "avatar_styles": ["prompt1", "prompt2", ...],
  "banner_styles": ["prompt1", "prompt2", ...]
}`;

export async function POST() {
  try {
    const connected = await ollama.isConnected();
    if (!connected) {
      return NextResponse.json(
        { success: false, error: "Ollama is not connected" },
        { status: 502 }
      );
    }

    const raw = await ollama.generate(PROMPT, {
      format: "json",
      temperature: 0.9,
      maxTokens: 4096,
    });

    let result: GeneratedStyles;
    try {
      result = JSON.parse(raw) as GeneratedStyles;
    } catch {
      return NextResponse.json(
        { success: false, error: "Ollama returned invalid JSON" },
        { status: 500 }
      );
    }

    // Validate structure
    if (
      !Array.isArray(result.avatar_styles) ||
      !Array.isArray(result.banner_styles) ||
      result.avatar_styles.length === 0 ||
      result.banner_styles.length === 0
    ) {
      return NextResponse.json(
        { success: false, error: "Ollama returned invalid structure" },
        { status: 500 }
      );
    }

    // Filter out any empty strings
    const avatar_styles = result.avatar_styles.filter((s) => typeof s === "string" && s.trim().length > 0);
    const banner_styles = result.banner_styles.filter((s) => typeof s === "string" && s.trim().length > 0);

    return NextResponse.json({
      success: true,
      data: { avatar_styles, banner_styles },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
