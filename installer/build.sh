#!/usr/bin/env bash
# Builds the MSI from DashcamPlayer.wxs.
#
# wixl cannot parse <RemoveFile>, so those rows are stripped out before it
# runs and put back afterwards with msibuild, then sorted into key order. They are what deletes the app's
# own runtime files on uninstall; without them the data folder is left behind.
# Keeping this in a script rather than doing it by hand is the point - the rows
# were reconstructed from memory once and came out short.
set -eu
# Resolve the script's own directory BEFORE moving into it: $0 is relative
# to the directory the script was called from, so re-deriving it after the cd
# gave installer/installer/.. and the table sort could not be found. Called
# from inside installer/ it happened to work, which is why it survived.
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"

VER=$(sed -n 's/.*<?define Ver = "\([0-9.]*\)" ?>.*/\1/p' DashcamPlayer.wxs)
[ -n "$VER" ] || { echo "no version in the wxs"; exit 1; }
OUT="DashcamPlayer-$VER.msi"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# 1. The RemoveFile rows, read out of the wxs so the two can never disagree.
#    MSI wants a short name too; these are all 8.3-able by hand.
{
  printf 'FileKey\tComponent_\tFileName\tDirProperty\tInstallMode\n'
  printf 's72\ts72\tL255\ts72\ti2\n'
  printf 'RemoveFile\tFileKey\n'
  printf 'R_AppMenuFolder\tC_Shortcuts\t\tAppMenuFolder\t2\n'
  printf 'R_InstallDir\tC_Registry\t\tINSTALLDIR\t2\n'
  printf 'R_DataDir\tC_DataFolder\t\tDATADIR\t2\n'
  grep -o '<RemoveFile Id="[^"]*"[[:space:]]*Name="[^"]*"' DashcamPlayer.wxs |
  while read -r line; do
    id=$(printf '%s' "$line" | sed 's/.*Id="\([^"]*\)".*/\1/')
    nm=$(printf '%s' "$line" | sed 's/.*Name="\([^"]*\)".*/\1/')
    stem=${nm%.*}; ext=${nm##*.}
    short=$(printf '%s' "$stem" | tr -d -c 'A-Za-z0-9' | tr '[:lower:]' '[:upper:]' | cut -c1-8)
    sext=$(printf '%s' "$ext" | tr '[:lower:]' '[:upper:]' | cut -c1-3)
    printf '%s\tC_DataFolder\t%s.%s|%s\tDATADIR\t2\n' "$id" "$short" "$sext" "$nm"
  done
} > "$WORK/RemoveFile.idt"

# 2. wixl on a copy with those elements taken out.
sed '/<RemoveFile /d' DashcamPlayer.wxs > "$WORK/build.wxs"
wixl -o "$OUT" "$WORK/build.wxs"

# 3. Put the table back.
msibuild "$OUT" -i "$WORK/RemoveFile.idt"

# 4. And put its rows back in order.
#
#    Windows Installer binary-searches a table's rows, so they must be stored
#    sorted by primary key; a table that is not is refused outright with
#    "Error 2211: Could not create database table RemoveFile", during
#    FileCost, naming no row and no reason. msibuild writes the rows in the
#    order this script lists them, but the sort key is each FileKey's index
#    in the package's string pool - a number the pool allocator hands out,
#    reusing freed slots, with no relation to the text. It came out ascending
#    for seven releases. In 1.34.0 one of two new rows landed in a reused low
#    slot, and the package was refused on Windows while still reading back
#    perfectly under msiinfo, msiextract and wine, none of which care.
python3 "$HERE/../tools/msi-table-order.py" --sort "$OUT"

echo "built $OUT"
msiinfo export "$OUT" RemoveFile
