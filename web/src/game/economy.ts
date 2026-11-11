import { BURN_RATE } from "./content";

const KEY = "orbitx-demo-wallet-v1";

export interface Wallet {
  balance: number;
  burned: number;
  owned: string[];
  color: string;
  hat: string;
  car: string;
  name: string;
}

const START: Wallet = {
  balance: 250,
  burned: 0,
  owned: [],
  color: "white",
  hat: "none",
  car: "black",
  name: "",
};

function freshName() {
  const n = 100 + Math.floor(Math.random() * 900);
  return `Guest ${n}`;
}

export function loadWallet(): Wallet {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      const wallet = { ...START, owned: [], name: freshName() };
      localStorage.setItem(KEY, JSON.stringify(wallet));
      return wallet;
    }
    const parsed = JSON.parse(raw) as Partial<Wallet>;
    return {
      ...START,
      ...parsed,
      owned: Array.isArray(parsed.owned) ? parsed.owned : [],
      name: parsed.name || freshName(),
    };
  } catch {
    return { ...START, owned: [], name: freshName() };
  }
}

export function saveWallet(wallet: Wallet) {
  localStorage.setItem(KEY, JSON.stringify(wallet));
}

export function burnAmount(price: number) {
  return Math.max(1, Math.round(price * BURN_RATE));
}

export function spend(wallet: Wallet, price: number, itemId: string): { ok: boolean; burned: number; message: string } {
  if (wallet.owned.includes(itemId)) {
    return { ok: true, burned: 0, message: "Already yours. Equipped." };
  }
  if (wallet.balance < price) {
    return { ok: false, burned: 0, message: "Not enough demo ORBITX." };
  }
  const burned = burnAmount(price);
  wallet.balance -= price;
  wallet.burned += burned;
  wallet.owned.push(itemId);
  saveWallet(wallet);
  return {
    ok: true,
    burned,
    message: `Spent ${price} demo ORBITX. Burned ${burned}. Burned total ${wallet.burned}.`,
  };
}

export function earn(wallet: Wallet, amount: number, reason: string) {
  wallet.balance += amount;
  saveWallet(wallet);
  return `${reason} paid ${amount} demo ORBITX.`;
}
