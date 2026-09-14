import qrcode from 'qrcode-generator';

/** QR code em SVG puro (sem canvas, sem imagem externa): imprime nítido em qualquer tamanho. */
export function QrCode({
  value,
  size = 176,
  label,
  testId,
}: {
  value: string;
  size?: number;
  label: string;
  testId?: string;
}) {
  const qr = qrcode(0, 'M');
  qr.addData(value);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 2;
  let d = '';
  for (let y = 0; y < n; y += 1)
    for (let x = 0; x < n; x += 1) if (qr.isDark(y, x)) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  const box = n + quiet * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid={testId}
      data-value={value}
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      shapeRendering="crispEdges"
      className="rounded-md bg-white"
    >
      <rect width={box} height={box} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
