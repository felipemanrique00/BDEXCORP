declare module 'sharp' {
  interface SharpInputOptions {
    failOn?: 'none' | 'truncated' | 'error' | 'warning'
    limitInputPixels?: number | boolean
    animated?: boolean
  }

  interface SharpMetadata {
    width?: number
    height?: number
    pages?: number
  }

  interface SharpResizeOptions {
    width?: number
    height?: number
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
    withoutEnlargement?: boolean
  }

  interface SharpWebpOptions {
    quality?: number
    alphaQuality?: number
    effort?: number
  }

  interface SharpPngOptions {
    compressionLevel?: number
    adaptiveFiltering?: boolean
  }

  interface SharpInstance {
    metadata(): Promise<SharpMetadata>
    rotate(): SharpInstance
    resize(options: SharpResizeOptions): SharpInstance
    png(options?: SharpPngOptions): SharpInstance
    webp(options?: SharpWebpOptions): SharpInstance
    toBuffer(): Promise<Buffer>
  }

  function sharp(input?: Buffer | Uint8Array, options?: SharpInputOptions): SharpInstance
  export default sharp
}
