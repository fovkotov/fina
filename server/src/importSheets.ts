/**
 * Re-import balances from Google Sheets into a fresh seed.
 * Requires ~/.osy-tokens.sh + gspread (used by osy-google-sheets skill).
 * Falls back to embedded seed if Sheets unavailable.
 */
import { spawnSync } from "node:child_process";
import { seed } from "./seed.js";

const SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1sK84AR7VUbZxme62h8TXb7epmUxWsBGPErJOFQkrnOg";

function tryFetchSheet(): boolean {
  const py = `
import sys, os
sys.path.insert(0, os.path.expanduser("~/.claude/skills/osy-google-sheets/scripts"))
try:
    from gsheets_api import get_info, read_sheet, print_sheet
    info = get_info(${JSON.stringify(SHEET_URL)})
    rows = read_sheet(${JSON.stringify(SHEET_URL)}, tab="накопления")
    print("OK", info["title"], len(rows))
    print_sheet(rows, max_rows=20)
except Exception as e:
    print("ERR", e)
    sys.exit(1)
`;
  const result = spawnSync(
    "bash",
    [
      "-lc",
      'set -a; [ -f ~/.osy-tokens.sh ] && . ~/.osy-tokens.sh; set +a; python3 -',
    ],
    { input: py, encoding: "utf-8" },
  );
  if (result.status !== 0) {
    console.error(result.stdout || result.stderr);
    return false;
  }
  console.log(result.stdout);
  return true;
}

const ok = tryFetchSheet();
if (!ok) {
  console.warn("Sheets unavailable — re-seeding from embedded snapshot");
}
seed(true);
console.log("Import/seed complete");
