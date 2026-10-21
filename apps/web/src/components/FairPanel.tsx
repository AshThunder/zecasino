export function FairPanel({ commitment, clientSeed, nonce, extra }: { commitment: string; clientSeed: string; nonce: number; extra?: React.ReactNode }) {
  return (
    <aside className="fair">
      <h4>Provably fair</h4>
      <dl>
        <dt>Server seed commitment</dt><dd className="mono">{commitment}</dd>
        <dt>Your client seed</dt><dd className="mono">{clientSeed}</dd>
        <dt>Nonce</dt><dd className="mono">{nonce}</dd>
      </dl>
      {extra}
      <p>Result = HMAC-SHA256(server seed, “client seed:nonce:0”). Rotate to reveal the seed and verify.</p>
    </aside>
  );
}
