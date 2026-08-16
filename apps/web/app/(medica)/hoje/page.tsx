import { currentUserSession } from '@/lib/session';

export default async function HojePage() {
  const s = await currentUserSession();
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Hoje</h1>
      <p className="text-muted-foreground">
        Olá, {s?.name}. O painel do dia (não respondeu · alertas · próximos envios · confirmações de
        dose) entra em E6.
      </p>
    </div>
  );
}
