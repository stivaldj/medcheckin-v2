export default function InvalidoPage() {
  return (
    <main style={{ maxWidth: 420, margin: '4rem auto', fontFamily: 'system-ui' }}>
      <h1>Link inválido ou expirado</h1>
      <p>
        Peça um novo em <a href="/login">/login</a>.
      </p>
    </main>
  );
}
