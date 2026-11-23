/** Client for the server's asset-pack endpoints. */
import type { AssetItem } from "@mapmaker/core";

export interface AssetStatus {
  configured: boolean;
  dir?: string;
  scanning: boolean;
  scanned: number;
  total: number;
  packs: number;
  usablePacks: number;
  files: number;
  restricted: number;
  errors: { file: string; message: string }[];
  /** While pictures whose names say nothing are looked at, after a scan. */
  looking?: { done: number; total: number };
}

export interface AssetPack {
  key: string;
  name: string;
  files: number;
  categories: Record<string, number>;
  restricted: boolean;
  supersededBy?: string;
}

export async function fetchAssetStatus(): Promise<AssetStatus> {
  const r = await fetch("/api/assets/status");
  const j = await r.json();
  return j.configured ? j : { configured: false, scanning: false, scanned: 0, total: 0, packs: 0, usablePacks: 0, files: 0, restricted: 0, errors: [] };
}

export async function fetchPacks(): Promise<AssetPack[]> {
  return (await (await fetch("/api/assets/packs")).json()) as AssetPack[];
}

export async function fetchAssets(o: { pack?: string; cat?: string; q?: string; offset?: number; limit?: number }): Promise<{ total: number; items: AssetItem[] }> {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== "") p.set(k, String(v));
  return (await fetch(`/api/assets/list?${p}`)).json();
}

export const assetUrl = (id: string, thumb?: number) => `/api/assets/file?id=${encodeURIComponent(id)}${thumb ? `&thumb=${thumb}` : ""}`;
