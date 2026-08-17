import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function InvalidoPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Link inválido ou expirado</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          Peça um novo em{' '}
          <a href="/login" className="underline">
            /login
          </a>
          .
        </CardContent>
      </Card>
    </main>
  );
}
