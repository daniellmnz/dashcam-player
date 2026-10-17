#!/usr/bin/env python3
"""Check - or repair - the row order of every table in an MSI.

Windows Installer stores each table's rows sorted by primary key and
binary-searches them. A table whose rows are out of order cannot be built:
the install stops with "Error 2211: Could not create database table <name>",
which names no file, no row and no reason.

This matters here because `msibuild -i` writes the rows of an imported table
in the order they appear in the .idt, while the sort key is the string's
index in the package's string pool - a number the string pool allocator
hands out, reusing freed slots, with no relation to the text. Seven releases
of this project happened to get ascending indices and installed fine. The
eighth added two rows, one of which landed in a reused low slot, and the
package was refused on Windows while reading back perfectly with msiinfo,
msiextract and wine, none of which care about row order.

    msi-table-order.py --check FILE.msi     say which tables are out of order
    msi-table-order.py --sort  FILE.msi     rewrite them in order, in place
"""
import argparse, struct, sys

try:
    import olefile
except ImportError:
    sys.exit("olefile is needed: pip install --break-system-packages olefile")

# MSI mangles stream names into a private range. This maps them back. A
# table's stream carries a leading U+4840 marking it as a table rather than
# an ordinary stream; it is not part of the table's name.
TABLE_PREFIX = '䡀'

# MSI mangles stream names into a private range. This maps them back.
ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz._"

def demangle(name):
    out = []
    for ch in name:
        c = ord(ch)
        if 0x3800 <= c < 0x4800:
            v = c - 0x3800
            out.append(ALPHABET[v & 0x3F]); out.append(ALPHABET[(v >> 6) & 0x3F])
        elif 0x4800 <= c < 0x4840:
            out.append(ALPHABET[c - 0x4800])
        else:
            out.append(ch)
    return "".join(out)

def read_streams(path):
    ole = olefile.OleFileIO(path)
    streams = {}
    for entry in ole.listdir():
        streams[demangle(entry[-1])] = (entry, ole.openstream('/'.join(entry)).read())
    ole.close()
    return streams

def string_table(streams):
    pool = next(v for k, (e, v) in streams.items() if k.lstrip(TABLE_PREFIX) == '_StringPool')
    data = next(v for k, (e, v) in streams.items() if k.lstrip(TABLE_PREFIX) == '_StringData')
    out, off, i = [None], 0, 4          # entry 0 is the codepage header
    while i + 4 <= len(pool):
        length, _refs = struct.unpack_from('<HH', pool, i); i += 4
        out.append(data[off:off + length].decode('utf-8', 'replace')); off += length
    return out

def schema(streams, strings):
    """{table: [(number, name, type), ...]} out of the _Columns table."""
    raw = next(v for k, (e, v) in streams.items() if k.lstrip(TABLE_PREFIX) == '_Columns')
    cells = struct.unpack(f'<{len(raw) // 2}H', raw)
    n = len(cells) // 4
    out = {}
    for r in range(n):
        table = strings[cells[r]]
        number = cells[n + r] - 0x8000
        name = strings[cells[2 * n + r]]
        typ = cells[3 * n + r] - 0x8000
        out.setdefault(table, []).append((number, name, typ))
    for cols in out.values():
        cols.sort()
    return out

def widths(cols):
    """Bytes each column occupies in the stream. Strings are an index into
    the string pool; integers carry their width in the low byte."""
    sizes = []
    for _num, _name, typ in cols:
        sizes.append(2 if typ & 0x0800 else (typ & 0xFF))
    return sizes

def decode(blob, cols):
    sizes = widths(cols)
    row_width = sum(sizes)
    if row_width == 0 or len(blob) % row_width:
        return None, None
    rows = len(blob) // row_width
    columns, off = [], 0
    for size in sizes:
        fmt = '<H' if size == 2 else '<I'
        columns.append([struct.unpack_from(fmt, blob, off + r * size)[0] for r in range(rows)])
        off += rows * size
    return columns, rows

def encode(columns, cols):
    out = b''
    for column, size in zip(columns, widths(cols)):
        fmt = '<H' if size == 2 else '<I'
        out += b''.join(struct.pack(fmt, v) for v in column)
    return out

def examine(path):
    """[(table, stream entry, cols, columns, rows, in_order)]"""
    streams = read_streams(path)
    strings = string_table(streams)
    sch = schema(streams, strings)
    found = []
    for name, (entry, blob) in sorted(streams.items()):
        table = name[1:] if name[:1] == TABLE_PREFIX else name
        if table.startswith('_') or table not in sch:
            continue
        cols = sch[table]
        columns, rows = decode(blob, cols)
        if columns is None or rows < 2:
            continue
        keys = [i for i, (_n, _nm, typ) in enumerate(cols) if typ & 0x2000]
        if not keys:
            continue
        # Compared on the FIRST key column only. wixl's own Upgrade table has
        # two rows sharing an UpgradeCode whose later key columns descend, and
        # Windows installs it without complaint, so a full tuple comparison
        # reports a package that demonstrably works. A first key column that
        # goes backwards is the shape that is actually refused.
        order = [columns[keys[0]][r] for r in range(rows)]
        found.append((table, entry, cols, columns, rows, keys,
                      all(order[i] <= order[i + 1] for i in range(len(order) - 1))))
    return found

def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('msi')
    ap.add_argument('--check', action='store_true', help='report only; exit 1 if any table is out of order')
    ap.add_argument('--sort', action='store_true', help='rewrite out-of-order tables in place')
    args = ap.parse_args()
    if not (args.check or args.sort):
        ap.error('pass --check or --sort')

    bad = [t for t in examine(args.msi) if not t[6]]
    if not bad:
        print(f'{args.msi}: every table is sorted by primary key')
        return 0

    for table, _entry, _cols, columns, rows, keys, _ok in bad:
        order = [columns[keys[0]][r] for r in range(rows)]
        first = next(r for r in range(1, rows) if order[r] < order[r - 1])
        print(f'{args.msi}: {table} is out of order at row {first + 1} of {rows} '
              f'({order[first - 1]} then {order[first]})')

    if args.check:
        return 1

    # Rewrite each offending table with its rows in key order. Only the row
    # order changes: the same cells, the same strings, the same stream size.
    ole = olefile.OleFileIO(args.msi, write_mode=True)
    try:
        for table, entry, cols, columns, rows, keys, _ok in bad:
            # A stable sort on the first key column: rows that share one keep
            # the order the package already had.
            order = sorted(range(rows), key=lambda r: columns[keys[0]][r])
            fixed = [[column[r] for r in order] for column in columns]
            blob = encode(fixed, cols)
            ole.write_stream('/'.join(entry), blob)
            print(f'{args.msi}: {table} rewritten in key order ({rows} rows)')
    finally:
        ole.close()

    still = [t[0] for t in examine(args.msi) if not t[6]]
    if still:
        print(f'{args.msi}: still out of order after rewriting: {", ".join(still)}')
        return 1
    print(f'{args.msi}: every table is now sorted by primary key')
    return 0

if __name__ == '__main__':
    sys.exit(main())
