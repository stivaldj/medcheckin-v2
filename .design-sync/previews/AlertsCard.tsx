import { AlertsCard } from '@medcheckin/web';
import { ALERTS, CONDUCTS } from './_fixtures';

export function ComAlertas() {
  return (
    <div className="w-[560px]">
      <AlertsCard alerts={ALERTS} conducts={CONDUCTS} />
    </div>
  );
}

export function SemAlertas() {
  return (
    <div className="w-[560px]">
      <AlertsCard alerts={[]} conducts={[]} />
    </div>
  );
}
