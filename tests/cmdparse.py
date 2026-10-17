# Models the ordering that makes this bug real:
#   phase 1  %VAR% substituted into the line text
#   phase 2  line scanned; " toggles quote state; & | ( ) < > act when OUTSIDE quotes
#   phase 3  !VAR! substituted AFTER the scan - values are never re-scanned
import re
SPECIAL = set('&|()<>')

def analyse(line, pct, label):
    # phase 1: percent expansion happens before the scan
    expanded = re.sub(r'%(\w+)%', lambda m: pct.get(m.group(1), m.group(0)), line)
    inq, breaks = False, []
    for i, ch in enumerate(expanded):
        if ch == '"':
            inq = not inq
        elif ch in SPECIAL and not inq:
            breaks.append((i, ch))
    print(f"{label}")
    print(f"  quotes on line        : {expanded.count('\"')}")
    print(f"  unquoted metachars    : {breaks if breaks else 'none'}")
    if breaks:
        i = breaks[0][0]
        print(f"  break-out at          : ...{expanded[max(0,i-28):i+16]}...")
        print(f"  VERDICT               : VULNERABLE - cmd ends the set here and runs the rest")
    else:
        print(f"  VERDICT               : safe - no metacharacter reaches the scan")
    print()

# A file named  a&calc  (browsers keep & in download names)
EVIL = 'a&calc'

OLD = 'set "OUTS=!OUTS! -map [v%IDX%] !ENCX! %AUD% "%OUT%\\%NAME%_!VLAB!.mp4""'
NEW = 'set OUTS=!OUTS! -map [v%IDX%] !ENCX! %AUD% "%OUT%\\!NAME!_!VLAB!.mp4"'
pct = {'IDX':'1','AUD':'-an','OUT':'C:\\out','NAME':EVIL}

print(f'file name under test    : {EVIL}.mp4\n')
analyse(OLD, pct, 'BEFORE  set "OUTS=... %NAME% ..."   (line 264)')
analyse(NEW, pct, 'AFTER   set OUTS=... !NAME! ...     (line 277)')

print('echo lines')
analyse('echo Splitting %NAME%', pct, '  BEFORE  echo Splitting %NAME%')
analyse('echo Splitting !NAME!', pct, '  AFTER   echo Splitting !NAME!')

# line 158 sits inside a parenthesised block, so ) closes it early too
pct2 = dict(pct); pct2['NAME'] = 'a)whoami'
print('inside the parenthesised block, name "a)whoami.mp4"')
analyse('  echo   Could not read the picture size of %NAME%.', pct2, '  BEFORE')
analyse('  echo   Could not read the picture size of !NAME!.', pct2, '  AFTER')
