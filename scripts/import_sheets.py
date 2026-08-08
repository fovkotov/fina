#!/usr/bin/env python3
"""Print Google Sheet snapshot used for seed verification."""

import os
import sys

sys.path.insert(0, os.path.expanduser("~/.claude/skills/osy-google-sheets/scripts"))

URL = "https://docs.google.com/spreadsheets/d/1sK84AR7VUbZxme62h8TXb7epmUxWsBGPErJOFQkrnOg"


def main() -> None:
    from gsheets_api import get_info, print_sheet, read_sheet

    info = get_info(URL)
    print(info["title"], info["tabs"])
    rows = read_sheet(URL, tab="накопления")
    print_sheet(rows, max_rows=40)


if __name__ == "__main__":
    main()
