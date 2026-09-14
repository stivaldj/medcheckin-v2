/**
 * E9.3 — link do WhatsApp com a mensagem do convite pronta. Nada vai para o servidor: é só um
 * link que a médica abre no próprio WhatsApp. `wa.me` exige dígitos com DDI; número brasileiro
 * sem DDI (10–11 dígitos) ganha 55. Sem número válido, abre o WhatsApp para escolher o contato.
 */
export function whatsappLink(r: { name: string; phone: string | null; invite_url: string }) {
  const text =
    `Olá, ${r.name}! Este é o seu acesso ao MedCheck-in, da clínica:\n${r.invite_url}\n\n` +
    'No iPhone, abra no Safari. No Android, abra no Chrome. Depois é só seguir os passos da tela.';
  let digits = String(r.phone ?? '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return `https://wa.me/${digits.length >= 12 && digits.length <= 13 ? digits : ''}?text=${encodeURIComponent(text)}`;
}
