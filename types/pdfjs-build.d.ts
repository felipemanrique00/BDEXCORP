declare module 'pdfjs-dist/build/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string }

  export interface PDFTextItem {
    str?: string
    [key: string]: unknown
  }

  export interface PDFPageProxy {
    getTextContent(): Promise<{ items: PDFTextItem[] }>
    cleanup?(): void
  }

  export interface PDFDocumentProxy {
    numPages: number
    getPage(pageNumber: number): Promise<PDFPageProxy>
    destroy?(): Promise<void>
  }

  export interface PDFDocumentLoadingTask {
    promise: Promise<PDFDocumentProxy>
  }

  export function getDocument(source: { data: ArrayBuffer } | ArrayBuffer): PDFDocumentLoadingTask
}
