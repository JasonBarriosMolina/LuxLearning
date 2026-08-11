'use client';

import { Send, Mail, FileText, Loader2 } from 'lucide-react';

interface Props {
  emailTo: string;
  setEmailTo: (v: string) => void;
  emailSending: boolean;
  emailSent: boolean;
  emailError: string;
  onSendEmail: () => void;
  onPrint: () => void;
  labels: {
    title: string;
    emailPlaceholder: string;
    sendEmailBtn: string;
    sent: string;
    downloadPdf: string;
    emailSentMsg: string;
  };
}

export function ExportBar({
  emailTo, setEmailTo, emailSending, emailSent, emailError,
  onSendEmail, onPrint, labels,
}: Props) {
  return (
    <div className="card no-print">
      <h2 className="font-heading font-bold text-base text-charcoal flex items-center gap-2 mb-4">
        <Send className="w-5 h-5 text-cta-from" /> {labels.title}
      </h2>
      <div className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 flex gap-2">
            <input
              type="email"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              placeholder={labels.emailPlaceholder}
              className="flex-1 px-4 py-2.5 rounded-xl border border-border bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cta-from"
            />
            <button
              onClick={onSendEmail}
              disabled={!emailTo || emailSending}
              className="flex items-center gap-2 px-4 py-2.5 bg-cta-gradient text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity"
            >
              {emailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              {emailSent ? labels.sent : labels.sendEmailBtn}
            </button>
          </div>
          <button
            onClick={onPrint}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border text-sm font-semibold text-gray-600 hover:bg-surface transition-colors"
          >
            <FileText className="w-4 h-4" /> {labels.downloadPdf}
          </button>
        </div>
        {emailError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{emailError}</p>
        )}
        {emailSent && (
          <p className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{labels.emailSentMsg}</p>
        )}
      </div>
    </div>
  );
}
