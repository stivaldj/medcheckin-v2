// Shim de next/navigation para o bundle do design system.
// Os componentes só usam useRouter/usePathname; fora do Next não há router,
// então devolvemos no-ops estáveis para o preview renderizar.
export function useRouter() {
  return {
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    forward: () => {},
    prefetch: () => {},
  };
}
// Uma rota real (e não '/') para que os componentes com estado ativo — MedicaNav, por
// exemplo — mostrem esse estado no card em vez de aparecerem todos inertes.
export function usePathname() {
  return '/pacientes';
}
export function useSearchParams() {
  return new URLSearchParams();
}
export function useParams<T extends Record<string, string> = Record<string, string>>() {
  return {} as T;
}
export function redirect(_url: string): never {
  throw new Error('redirect() não é suportado fora do Next');
}
export function notFound(): never {
  throw new Error('notFound() não é suportado fora do Next');
}
