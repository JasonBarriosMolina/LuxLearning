import { permanentRedirect } from 'next/navigation';

// The demo request lives on the institutions page; keep old links working.
export default function DemoPage() {
  permanentRedirect('/instituciones#agendar-demo');
}
