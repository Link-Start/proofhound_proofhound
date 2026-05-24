import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { InvokeLLMArgs, LLMImagePreprocessOptions, LLMInferenceParams } from './types';

const DEFAULT_MAX_EDGE_PIXELS = 2048;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_INPUT_BYTES = 50 * 1024 * 1024;
const DEFAULT_JPEG_QUALITY = 85;
const DEFAULT_MIN_JPEG_QUALITY = 60;
const MIN_RESIZE_EDGE_PIXELS = 512;

const DATA_URL_PATTERN = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/isu;

interface NormalizedImagePreprocessOptions {
  maxEdgePixels: number;
  maxOutputBytes: number;
  maxInputBytes: number;
  jpegQuality: number;
  minJpegQuality: number;
}

interface ProcessedImage {
  base64: string;
  mediaType: string;
  ref: ImageRef;
}

interface ImageRef {
  kind: 'base64' | 'url';
  mediaType?: string;
  sha256?: string;
  byteLength?: number;
  width?: number;
  height?: number;
  resized?: boolean;
  original?: {
    mediaType: string;
    sha256: string;
    byteLength: number;
    width?: number;
    height?: number;
  };
  url?: string;
}

interface DecodedImageInput {
  mediaType: string;
  base64: string;
}

export async function preprocessLLMImageInputs(args: InvokeLLMArgs): Promise<InvokeLLMArgs> {
  const params = args.params ?? {};
  if (params.imagePreprocess === false || !args.messages) {
    return args;
  }

  const options = normalizeOptions(params.imagePreprocess);
  const imageRefs: ImageRef[] = [];
  let changed = false;
  const messages: NonNullable<InvokeLLMArgs['messages']> = [];

  for (const message of args.messages) {
    if (!Array.isArray(message.content)) {
      messages.push(message);
      continue;
    }

    let contentChanged = false;
    const content: Array<Record<string, unknown>> = [];
    for (const part of message.content) {
      const processed = await preprocessMessagePart(part, options, imageRefs);
      contentChanged ||= processed !== part;
      content.push(processed);
    }

    if (contentChanged) {
      changed = true;
      messages.push({ ...message, content });
    } else {
      messages.push(message);
    }
  }

  if (!changed && imageRefs.length === 0) {
    return args;
  }

  return {
    ...args,
    messages: changed ? messages : args.messages,
    params: {
      ...params,
      imageRefs: mergeImageRefs(params.imageRefs, imageRefs),
    },
  };
}

async function preprocessMessagePart(
  part: Record<string, unknown>,
  options: NormalizedImagePreprocessOptions,
  imageRefs: ImageRef[],
): Promise<Record<string, unknown>> {
  const openAIImage = extractOpenAIImage(part);
  if (openAIImage) {
    if (isRemoteUrl(openAIImage.url)) {
      imageRefs.push({ kind: 'url', url: openAIImage.url });
      return part;
    }

    const decoded = decodeDataUrl(openAIImage.url);
    if (!decoded) return part;

    const processed = await preprocessBase64Image(decoded, options);
    imageRefs.push(processed.ref);
    return {
      ...part,
      image_url: {
        ...openAIImage.imageUrl,
        url: toDataUrl(processed.mediaType, processed.base64),
      },
    };
  }

  const anthropicImage = extractAnthropicImage(part);
  if (anthropicImage) {
    if (isRemoteUrl(anthropicImage.url)) {
      imageRefs.push({ kind: 'url', url: anthropicImage.url });
      return part;
    }

    if (!anthropicImage.base64) return part;

    const processed = await preprocessBase64Image(
      { mediaType: anthropicImage.mediaType, base64: anthropicImage.base64 },
      options,
    );
    imageRefs.push(processed.ref);
    return {
      ...part,
      source: {
        ...anthropicImage.source,
        media_type: processed.mediaType,
        data: processed.base64,
      },
    };
  }

  return part;
}

function extractOpenAIImage(part: Record<string, unknown>):
  | {
      imageUrl: Record<string, unknown>;
      url: string;
    }
  | undefined {
  if (part['type'] !== 'image_url') return undefined;
  const imageUrl = part['image_url'];
  if (!isRecord(imageUrl) || typeof imageUrl['url'] !== 'string') return undefined;
  return { imageUrl, url: imageUrl['url'] };
}

function extractAnthropicImage(part: Record<string, unknown>):
  | {
      source: Record<string, unknown>;
      mediaType: string;
      base64?: string;
      url?: string;
    }
  | undefined {
  if (part['type'] !== 'image') return undefined;
  const source = part['source'];
  if (!isRecord(source)) return undefined;

  if (source['type'] === 'base64' && typeof source['data'] === 'string') {
    return {
      source,
      mediaType: typeof source['media_type'] === 'string' ? source['media_type'] : 'image/jpeg',
      base64: source['data'],
    };
  }

  if (source['type'] === 'url' && typeof source['url'] === 'string') {
    return {
      source,
      mediaType: typeof source['media_type'] === 'string' ? source['media_type'] : 'image/jpeg',
      url: source['url'],
    };
  }

  return undefined;
}

async function preprocessBase64Image(
  input: DecodedImageInput,
  options: NormalizedImagePreprocessOptions,
): Promise<ProcessedImage> {
  const normalizedBase64 = normalizeBase64(input.base64);
  assertImageWithinDecodeLimit(normalizedBase64, options.maxInputBytes);

  const bytes = Buffer.from(normalizedBase64, 'base64');
  if (bytes.length === 0) {
    throw new ImagePreprocessError('image payload is empty');
  }

  const metadata = await readImageMetadata(bytes);
  const original = {
    mediaType: normalizeMediaType(input.mediaType),
    sha256: sha256(bytes),
    byteLength: bytes.length,
    width: metadata.width,
    height: metadata.height,
  };
  const needsResize =
    typeof metadata.width === 'number' &&
    typeof metadata.height === 'number' &&
    Math.max(metadata.width, metadata.height) > options.maxEdgePixels;
  const needsReencode = bytes.length > options.maxOutputBytes || needsResize;

  if (!needsReencode) {
    return {
      base64: normalizedBase64,
      mediaType: original.mediaType,
      ref: {
        kind: 'base64',
        mediaType: original.mediaType,
        sha256: original.sha256,
        byteLength: original.byteLength,
        width: original.width,
        height: original.height,
        resized: false,
      },
    };
  }

  const resized = await resizeImage(bytes, options);
  return {
    base64: resized.bytes.toString('base64'),
    mediaType: 'image/jpeg',
    ref: {
      kind: 'base64',
      mediaType: 'image/jpeg',
      sha256: sha256(resized.bytes),
      byteLength: resized.bytes.length,
      width: resized.width,
      height: resized.height,
      resized: true,
      original,
    },
  };
}

async function resizeImage(
  bytes: Buffer,
  options: NormalizedImagePreprocessOptions,
): Promise<{ bytes: Buffer; width?: number; height?: number }> {
  let maxEdge = options.maxEdgePixels;
  let lastOutput: Buffer | undefined;

  while (maxEdge >= MIN_RESIZE_EDGE_PIXELS) {
    for (const quality of jpegQualitySteps(options.jpegQuality, options.minJpegQuality)) {
      const output = await sharp(bytes, { failOn: 'none' })
        .rotate()
        .resize({
          width: maxEdge,
          height: maxEdge,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();

      lastOutput = output;
      if (output.length <= options.maxOutputBytes) {
        const metadata = await sharp(output).metadata();
        return { bytes: output, width: metadata.width, height: metadata.height };
      }
    }

    maxEdge = Math.floor(maxEdge * 0.75);
  }

  throw new ImagePreprocessError(
    `image remains too large after resize: ${lastOutput?.length ?? bytes.length} bytes > ${options.maxOutputBytes} bytes`,
  );
}

async function readImageMetadata(bytes: Buffer): Promise<{ width?: number; height?: number }> {
  try {
    const metadata = await sharp(bytes, { failOn: 'none' }).metadata();
    return { width: metadata.width, height: metadata.height };
  } catch (error) {
    throw new ImagePreprocessError(
      `image payload cannot be decoded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function decodeDataUrl(value: string): DecodedImageInput | undefined {
  const match = DATA_URL_PATTERN.exec(value);
  if (!match?.[1] || !match[2]) return undefined;
  return { mediaType: match[1], base64: match[2] };
}

function toDataUrl(mediaType: string, base64: string): string {
  return `data:${mediaType};base64,${base64}`;
}

function normalizeBase64(value: string): string {
  return value.replace(/\s/gu, '');
}

function assertImageWithinDecodeLimit(base64: string, maxInputBytes: number): void {
  const estimatedBytes = Math.ceil((base64.length * 3) / 4);
  if (estimatedBytes > maxInputBytes) {
    throw new ImagePreprocessError(`image payload is too large to decode: ${estimatedBytes} bytes > ${maxInputBytes} bytes`);
  }
}

function normalizeOptions(options?: LLMImagePreprocessOptions): NormalizedImagePreprocessOptions {
  return {
    maxEdgePixels: normalizePositiveInteger(options?.maxEdgePixels, DEFAULT_MAX_EDGE_PIXELS),
    maxOutputBytes: normalizePositiveInteger(options?.maxOutputBytes, DEFAULT_MAX_OUTPUT_BYTES),
    maxInputBytes: normalizePositiveInteger(options?.maxInputBytes, DEFAULT_MAX_INPUT_BYTES),
    jpegQuality: clampQuality(options?.jpegQuality ?? DEFAULT_JPEG_QUALITY),
    minJpegQuality: clampQuality(options?.minJpegQuality ?? DEFAULT_MIN_JPEG_QUALITY),
  };
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function clampQuality(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_JPEG_QUALITY;
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function jpegQualitySteps(start: number, end: number): number[] {
  const upper = Math.max(start, end);
  const lower = Math.min(start, end);
  const steps: number[] = [];
  for (let quality = upper; quality >= lower; quality -= 10) {
    steps.push(quality);
  }
  if (!steps.includes(lower)) steps.push(lower);
  return steps;
}

function mergeImageRefs(existing: LLMInferenceParams['imageRefs'], generated: ImageRef[]): LLMInferenceParams['imageRefs'] {
  if (generated.length === 0) return existing;
  if (existing === undefined) return generated;
  return [...(Array.isArray(existing) ? existing : [existing]), ...generated];
}

function normalizeMediaType(value: string): string {
  return value.trim().toLowerCase() || 'image/jpeg';
}

function isRemoteUrl(value: string | undefined): value is string {
  return typeof value === 'string' && /^https?:\/\//iu.test(value);
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class ImagePreprocessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagePreprocessError';
  }
}
