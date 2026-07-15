'use client';

import { useRef, useState } from 'react';
import { Upload, FileText, X, Loader2, CheckCircle } from 'lucide-react';
import { api } from '@/lib/api';

interface FileUploadProps {
  folder?: 'tasks' | 'resources' | 'uploads' | 'photos' | 'covers' | 'editor';
  accept?: string; // e.g. ".pdf,.docx,.pptx"
  maxSizeMB?: number;
  onUploaded: (result: { fileUrl: string; fileKey: string; fileName: string; fileType: string; fileSize: number }) => void;
  onError?: (msg: string) => void;
  disabled?: boolean;
  label?: string;
}

export function FileUpload({ folder = 'uploads', accept, maxSizeMB = 50, onUploaded, onError, disabled, label }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploaded, setUploaded] = useState<{ name: string; url: string } | null>(null);

  const handleFile = async (file: File) => {
    if (file.size > maxSizeMB * 1024 * 1024) {
      onError?.(`El archivo supera el límite de ${maxSizeMB} MB`);
      return;
    }
    setUploading(true); setProgress(10);
    try {
      // 1. Get presigned URL from backend
      const presignRes = await api.admin.files.presign({ fileName: file.name, fileType: file.type, folder });
      const { uploadUrl, fileKey, publicUrl } = (presignRes as any).data ?? presignRes;
      setProgress(30);

      // 2. Upload directly to S3 via presigned URL
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) setProgress(30 + Math.round((e.loaded / e.total) * 60));
        });
        xhr.addEventListener('load', () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`S3 upload failed: ${xhr.status}`))));
        xhr.addEventListener('error', () => reject(new Error('Error de red al subir archivo')));
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      });

      setProgress(100);
      setUploaded({ name: file.name, url: publicUrl });
      onUploaded({ fileUrl: publicUrl, fileKey, fileName: file.name, fileType: file.type, fileSize: file.size });
    } catch (err: any) {
      onError?.(err.message ?? 'Error al subir el archivo');
    } finally {
      setUploading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const reset = () => { setUploaded(null); setProgress(0); if (inputRef.current) inputRef.current.value = ''; };

  if (uploaded) {
    return (
      <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-900/40">
        <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="text-sm text-emerald-700 dark:text-emerald-400 flex-1 truncate">{uploaded.name}</span>
        <button onClick={reset} className="p-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors">
          <X className="w-3.5 h-3.5 text-emerald-600" />
        </button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => !disabled && !uploading && inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-2 p-5 rounded-xl border-2 border-dashed transition-colors cursor-pointer
        ${disabled || uploading ? 'opacity-50 cursor-not-allowed border-gray-200' : 'border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10'}`}
    >
      <input ref={inputRef} type="file" accept={accept} onChange={handleChange} className="hidden" disabled={disabled || uploading} />
      {uploading ? (
        <>
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
          <p className="text-sm text-gray-500">Subiendo... {progress}%</p>
          <div className="w-full h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div className="h-full bg-indigo-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </>
      ) : (
        <>
          <Upload className="w-6 h-6 text-indigo-400" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label ?? 'Arrastra o haz click para subir'}</p>
          <p className="text-xs text-gray-400">{accept ? accept.replace(/\./g, '').toUpperCase().replace(/,/g, ', ') : 'PDF, DOCX, PPTX, ZIP, imágenes'} — máx {maxSizeMB} MB</p>
        </>
      )}
    </div>
  );
}
