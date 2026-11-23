/** The "GM only" tick box (core secrets.ts): what is ticked is shown faintly here and left out of pictures and exports for players. */
export function GmOnlyBox({ on, onChange, what = "it" }: { on: boolean; onChange: (on: boolean) => void; what?: string }) {
  return (
    <label className="check" title={`Only you see ${what}: pictures and exports for players leave it out. It shows faintly here.`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} data-testid="gm-only" /> GM only (left out of player exports)
    </label>
  );
}
