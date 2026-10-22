import sys,pymupdf
sys.stdout.reconfigure(encoding='utf-8')
d=pymupdf.open(sys.argv[1])
for p in range(int(sys.argv[2]),int(sys.argv[3])+1):
    pg=d[p-1]; print('=====PAGE',p)
    ws=pg.get_text('words')
    ws.sort(key=lambda w:(round(w[1]),w[0]))
    rows=[]
    for w in ws:
        if rows and abs(rows[-1][0]-w[1])<3: rows[-1][1].append(w)
        else: rows.append([w[1],[w]])
    for y,r in rows:
        r.sort(key=lambda w:w[0]); s='';px=None
        for w in r:
            if px is not None: s+=' | ' if w[0]-px>14 else ' '
            s+=w[4]; px=w[2]
        print(s)
