// Mock data for the UI review build. Deposit address is a real Orchard-only testnet UA from the spike.
export const DEPOSIT = {
  address: "utest16ph0p9rte0xcu64qt3clcran2xtz8n3yg4n5qqt2tqqtlrrk95730xtfklh8sslaacafdlnnk34sqa4c22ng6qt38q4kmmc8nv0xkc8n",
  memoTag: "zc1:7f3a9c2e41b8d06f",
  amount: "0.05",
  diversifierIndex: 1042,
};
export const zip321 = (addr: string, amount: string, memo: string) => {
  const b64 = btoa(memo).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `zcash:${addr}?amount=${amount}&memo=${b64}`;
};
export const SESSION = { id: "ses_4c19…a2", balance: 0.4120, chainHeight: 4_523_418, anchor: 4_523_402 };
