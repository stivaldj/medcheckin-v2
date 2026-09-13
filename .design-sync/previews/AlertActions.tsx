import { AlertActions } from '@medcheckin/web';

export function Aberto() {
  return <AlertActions alertId="al-1" status="open" />;
}

export function Reconhecido() {
  return <AlertActions alertId="al-1" status="acknowledged" />;
}
