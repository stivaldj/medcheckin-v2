import { LinkIcon } from 'lucide-react';

export function NoSession() {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center" data-testid="no-session">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <LinkIcon className="size-5" />
      </div>
      <h1 className="text-lg font-semibold tracking-tight">Sessão não encontrada</h1>
      <p className="max-w-[32ch] text-sm text-muted-foreground">
        Leia de novo o QR code da clínica ou abra o link que ela mandou pelo WhatsApp. Ele conecta
        este celular ao acompanhamento.
      </p>
    </div>
  );
}
