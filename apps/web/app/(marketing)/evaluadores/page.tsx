import { permanentRedirect } from 'next/navigation';

// "Evaluadores" was renamed "Profesores"; keep old links working.
export default function EvaluadoresPage() {
  permanentRedirect('/profesores');
}
