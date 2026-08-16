export function NoSession() {
  return (
    <div className="space-y-2" data-testid="no-session">
      <h1 className="text-xl font-semibold">Sessão não encontrada</h1>
      <p className="text-sm text-muted-foreground">
        Abra o link de convite que a clínica enviou para você. Ele conecta este dispositivo ao
        acompanhamento.
      </p>
    </div>
  );
}
