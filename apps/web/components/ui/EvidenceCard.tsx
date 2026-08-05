'use client';

import { useEffect, useState, useRef } from 'react';
import { Upload, CheckCircle, FileText, Loader2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useLanguage } from '@/lib/i18n';

interface EvidenceCardProps {
  courseId: string;
  moduleId: string;
  evalName: string;
  instructions?: string | null;
}

export function EvidenceCard({ courseId, moduleId, evalName, instructions }: EvidenceCardProps) {
  const { t } = useLanguage();
  const tc = t.evidenceCard;

  const [submissions, setSubmissions] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.submissions.list(moduleId).then((res: any) => {
      setSubmissions(res?.data ?? []);
    }).catch(() => {});
  }, [moduleId]);

  const latestSub = submissions[submissions.length - 1];
  const isGraded = latestSub?.status === 'graded';

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const presignRes = await api.submissions.presign({
        courseId, moduleId, fileName: file.name,
        fileType: file.type || 'application/octet-stream',
      }) as any;
      const { submissionId, uploadUrl } = presignRes?.data ?? presignRes;
      // Upload directly to S3
      const s3Res = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!s3Res.ok) throw new Error('S3 upload failed');
      await api.submissions.register({
        submissionId, courseId, moduleId,
        fileName: file.name, fileSize: file.size,
        fileType: file.type || 'application/octet-stream',
      });
      const updated = await api.submissions.list(moduleId) as any;
      setSubmissions(updated?.data ?? []);
    } catch {
      setError(tc.errorUpload);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            isGraded ? 'bg-emerald-100' : latestSub ? 'bg-amber-100' : 'bg-orange-100'
          }`}>
            {isGraded
              ? <CheckCircle className="w-5 h-5 text-emerald-600" />
              : latestSub
              ? <FileText className="w-5 h-5 text-amber-600" />
              : <Upload className="w-5 h-5 text-orange-600" />}
          </div>
          <div>
            <p className="font-semibold text-charcoal text-sm">{evalName}</p>
            <p className="text-xs text-gray-500">
              {isGraded ? tc.graded : latestSub ? tc.submittedLabel : (instructions || tc.defaultHint)}
            </p>
          </div>
        </div>

        {!latestSub && (
          <>
            <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading
                ? <><Loader2 className="w-4 h-4 animate-spin mr-1.5" />{tc.uploading}</>
                : <><Upload className="w-4 h-4 mr-1.5" />{tc.upload}</>}
            </Button>
            <input ref={fileRef} type="file" className="hidden" onChange={handleFileChange} />
          </>
        )}

        {isGraded && <Badge variant="success">{tc.gradeValue(latestSub.grade ?? 0)}</Badge>}
        {latestSub && !isGraded && <Badge variant="pending">{tc.pending}</Badge>}
      </div>

      {instructions && !latestSub && (
        <p className="mt-3 text-xs text-gray-500 bg-surface rounded-lg p-3 leading-relaxed">
          {instructions}
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 shrink-0" />{error}
        </p>
      )}
      {latestSub && (
        <p className="mt-2 text-xs text-gray-400">
          {latestSub.fileName} · {new Date(latestSub.createdAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}
