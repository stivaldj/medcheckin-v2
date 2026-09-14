import { SetupWizard } from '@/components/pwa/setup/SetupWizard';

/** E9.3: ajuda do celular (botões "Ativar os avisos" / "testar de novo" da tela Hoje) — refaz os passos que faltam (avisos e teste) neste celular. */
export default function AjudaPage() {
  return <SetupWizard mode="help" />;
}
