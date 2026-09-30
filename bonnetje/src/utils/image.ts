import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

// Long receipts need height, but phone photos are far bigger than Gemini needs.
const MAX_SIDE = 2800;

/** Downscales if needed and always re-encodes as JPEG (which also converts HEIC). */
export async function prepareImage(
  uri: string,
  width: number,
  height: number
): Promise<{ base64: string; mimeType: string }> {
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > MAX_SIDE) {
    ctx.resize(height >= width ? { height: MAX_SIDE } : { width: MAX_SIDE });
  }
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  if (!out.base64) throw new Error("no base64");
  return { base64: out.base64, mimeType: "image/jpeg" };
}
